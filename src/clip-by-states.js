const intersect = require('@turf/intersect');
const fs = require('fs');
const path = require('path');
var args = process.argv.slice(2);

var input = args[0];
var output = args[1];

const statesLayer = JSON.parse(fs.readFileSync(path.join(__dirname, 'states', 'states.geojson'), 'utf8'));
const windLayer = JSON.parse(fs.readFileSync(input, 'utf8'));

statesLayer.features = statesLayer.features.forEach((stateFeature) => {
    const conflictLayer = {
        "type": "FeatureCollection",
        "crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" } },
        "features": []
    };

    windLayer.features.reduce((prev, windFeature) => {
        var conflict = intersect(stateFeature, windFeature);
        if (conflict) {
            conflict.properties = windFeature.properties;
            prev.push(conflict);
        }
        return prev;
    }, conflictLayer.features);

    if (!conflictLayer.features.length) {
        return;
    }
    var dest = output.replace('%state%', stateFeature.properties.STATE_ABBR);
    fs.writeFileSync(dest, JSON.stringify(conflictLayer), "utf8");
}, []);