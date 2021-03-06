const turf = require('@turf/turf');
const _ = require('lodash/core');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const moment = require('moment');
const StringSimilarity = require('string-similarity');
const uuidv4 = require('uuid/v4');
const config = require('./comparator-config.json');

let dataOS,
    dataOSM = [];

//Extract data from file
readFile = (path) => {
  return fs.readFileAsync(path); //return file data
}

//Extract data from file
writeFile = (path, data) => {
  return fs.writeFileAsync(path, data); //return file data
}

//Extract data from each file
readAllFiles = () => {
  var promises = [];
  promises.push(readFile(config.inputFileOS)); //read in OS file first
  promises.push(readFile(config.inputFileOSM)); //read in OSM file second

  return Promise.all(promises); //return promise that is resolved when all files are done loading
}

//Create or append to output files specified in config file
createOutputFiles = () => {
  var promises = [];

  if (config.outputMode === "new") { //if user wants new output files
    promises.push(writeFile(config.outputFileOS, JSON.stringify({"roads": []}, null, 2)));
    promises.push(writeFile(config.outputFileOSM, JSON.stringify({"roads": []}, null, 2)));
    return Promise.all(promises); //create new output files
  } else if (config.outputMode === "append"){
    return Promise.resolve(true); // else files already exist
  } else {
    return console.error("Please enter new or append for output mode.");
  }
}

//Test which OSM roads intersect/are contained with an OS road
compareRoadsForOverlap = (road1, road2) => {

  const turfRoad1 = turf.lineString(road1.geometry.coordinates[0]); //convert OS road to turf linestring
  const turfRoad2 = turf.lineString(road2.geometry.coordinates); //convert OSM road to turf linestring
  const buffer = turf.buffer(turfRoad1, 0.05); //buffer the OS road by 50 metres

  const intersect = turf.lineIntersect(buffer, turfRoad2); //Check for intersections

  const overlap = _.isEmpty(intersect.features) ? false : true;
  const contains = turf.booleanContains(buffer, turfRoad2); //check to see if road is contained inside buffer

  if (overlap || contains) {
    return true; //if road intersects or is contained, return true
  } else {
    return false; //otherwise roads are not 50m within each other
  }

}

createOutputFiles().then((res) => {
  readAllFiles().then((res) => {
    dataOS = JSON.parse(res[0].toString()); //parse OS data
    dataOSM = JSON.parse(res[res.length-1].toString()); //parse OSM data

    const timeStarted = moment(); //the time the script starts
    const numOfRoads = dataOS.roads.length; //number of OS roads to check
    let numOfRoadsChecked = 0; //number of OS roads that have been checked

    //for every OS road
    for (var i = 0; i < dataOS.roads.length; i++) {
      let overlaps = []; //OSM roads that pass level 1 of filtering
      let nameMatches = []; //OSM roads pass level 2 of filtering
      let roadOSName = dataOS.roads[i].properties.roadname ? dataOS.roads[i].properties.roadname.toLowerCase() : "";
      let roadOSMName = "";

      //for every OSM road
      for (var j = 0; j < dataOSM.roads.length; j++) {
        roadOSMName = dataOSM.roads[j].properties.name;
        const coordOS = turf.point(dataOS.roads[i].geometry.coordinates[0][0]); //first OS coordinate
        const coordOSM = turf.point(dataOSM.roads[j].geometry.coordinates[0]); //first OSM coordinate
        const distanceBetween = turf.distance(coordOS, coordOSM); //distance between first coordinates

        //if start of roads are within 100m of each other
        if (distanceBetween < 0.1) {
          //level 1 filter - check to see if roads intersect/overlap
          compareRoadsForOverlap(dataOS.roads[i], dataOSM.roads[j]) ? overlaps.push(dataOSM.roads[j]) : "";
        }
      }

      // level 2 filter - check to see if road name strings are over 70% match
      if (roadOSName) {
        nameMatches = overlaps.filter((road) => {
          if (road.properties.name) { //if OSM road has a name attribute
            const comparison = StringSimilarity.compareTwoStrings(roadOSName, road.properties.name.toLowerCase());
            if (comparison > 0.7) { //if strings have 70% similarity match
              return true; //the road names are similar enough for a match
            } else {
              return false; //the road names are too different for a match
            }
          }
        });
      } else {
        nameMatches = overlaps;
      }

      //////// Output File Formatting ////////
      let newId = uuidv4(); //create a new, unique id for identical roads

      let newDataOS = JSON.parse(fs.readFileSync(config.outputFileOS).toString()); //read OS output file
      dataOS.roads[i].properties.commonID = newId; //add the common id to the road
      newDataOS.roads.push(dataOS.roads[i]); //push to the existing data
      fs.writeFileSync(config.outputFileOS, JSON.stringify(newDataOS, null, 2)); //write back to file

      let newDataOSM = JSON.parse(fs.readFileSync(config.outputFileOSM).toString()); //read OSM output file
      nameMatches.map((road) => {
        road.properties.commonID = newId; //add the common id to the roads
        newDataOSM.roads.push(road); //push to the existing data
      })
      fs.writeFileSync(config.outputFileOSM, JSON.stringify(newDataOSM, null, 2)); //write back to file
      //////// End of Output File Formatting ////////



      //////// Console Output Formatting ////////

      numOfRoadsChecked++; //increase number of roads checked
      let timeNow = moment(); //update time after checking road
      const timeDiff = timeNow.diff(timeStarted) / 1000; //calc diff between now and when script started
      const perSecond = numOfRoadsChecked / timeDiff; //num of roads checked per second
      const willFinish = moment().add((numOfRoads-numOfRoadsChecked) / perSecond, "seconds"); //ETA

      console.log("------------------------------------------------------------------");
      console.log(`=> Checking road ${i+1}/${numOfRoads}: ${dataOS.roads[i].properties.roadname}`);
      console.log("------------------------------------------------------------------");
      console.log("\nThe following possible matches were found in OSM Data:\n\n", nameMatches);
      console.log("\n------------------------------------------------------------------");
      console.log(`Processed ${numOfRoadsChecked}/${numOfRoads} (${perSecond * 60} per minute)`);
      console.log(`Started ${timeStarted.fromNow()}, will finish ${moment().to(willFinish)}`);
      console.log("------------------------------------------------------------------\n\n");

      //////// End of Console Output Formatting ////////
    }

  });
});
