const ee = require("@google/earthengine");
const path= require('path');
const cors = require('cors');
const express = require('express');
const fs = require("fs").promises;
const serverless = require('serverless-http');

const app = express();
const router = express.Router();

const { initializeApp } = require("firebase/app");
const { getFirestore, doc, getDoc, setDoc } = require("firebase/firestore");

const firebaseConfig = process.env.YOU_WISH;

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
var collectionName = "DistrictData"

async function readDocument(documentId) {
    try {
        const docRef = doc(db, collectionName, documentId);
        const docSnap = await getDoc(docRef);
  
    if (docSnap.exists()) {
        const documentData = docSnap.data(); 
        const jsonData = documentData;
        return jsonData;
    } else {
        console.log("No such document!");
        return null;
    }
    } catch (error) {
        console.error("Error reading document:", error);
        throw error;
    }
}

const key = process.env.CLOSE_BUT_NO_CIGAR;

function authenticate(key) {
    return new Promise((resolve, reject) => {
        ee.data.authenticateViaPrivateKey(
            key,
            () =>
                ee.initialize(
                    null,
                    null,
                    () => resolve(),
                    (error) => reject(new Error(error))
                ),
            (error) => reject(new Error(error))
        );
    });
}

let isInitialized = false;

async function initializeEarthEngine() {
    if (!isInitialized) {
        try {
			await authenticate(key);
			await ee.initialize();
			isInitialized = true;
            await processGeoJSON()
			console.log("Earth Engine initialized successfully!");
		} catch (error) {
			console.error("Error initializing Earth Engine:", error);
			return;
		}
    } else {
        console.log("Earth Engine already initialized.");
    }
}

async function vegetationtypeNdviEvi(LATITUDE, LONGITUDE, START_DATE, END_DATE) {
    await initializeEarthEngine();
    const lat = LATITUDE;
    const lon = LONGITUDE;
    const point = ee.Geometry.Point([lon, lat]);

    function sampleIndices(image) {
        const sampledPoint = image.reduceRegion({
            reducer: ee.Reducer.mean(),
            geometry: point,
            scale: 500,
        });

        return ee.Feature(null, {
            date: image.date().format("YYYY-MM-dd"),
            NDVI: sampledPoint.get("NDVI"),
            EVI: sampledPoint.get("EVI"),
        });
    }

    const dataset = ee
        .ImageCollection("MODIS/061/MOD13A1")
        .filter(ee.Filter.date(START_DATE, END_DATE));

    const indices = dataset.select(["NDVI", "EVI"]);
    const sampled = indices.map(sampleIndices);
    const sampledFc = ee.FeatureCollection(sampled);

    return new Promise((resolve, reject) => {
        sampledFc.evaluate((result, error) => {
            if (error) {
                console.error("Error evaluating sampled FeatureCollection:", error);
                reject(error);
            } else {
                const features = result.features || [];
                if (features.length > 0) {
                    const ndviValue = features[0].properties.NDVI || null;
                    const eviValue = features[0].properties.EVI || null;
                    resolve([ndviValue, eviValue]);
                } else {
                    resolve([null, null]);
                }
            }
        });
    });
}


async function vegetationtypeLaiFpar(LATITUDE, LONGITUDE, START_DATE, END_DATE) {
    await initializeEarthEngine();
    const lat = LATITUDE;
    const lon = LONGITUDE;
    const point = ee.Geometry.Point([lon, lat]);

    function sampleIndices(image) {
        const sampledPoint = image.reduceRegion({
            reducer: ee.Reducer.mean(),
            geometry: point,
            scale: 500,
        });

        return ee.Feature(null, {
            date: image.date().format("YYYY-MM-dd"),
            LAI: sampledPoint.get("Lai"),
            FPAR: sampledPoint.get("Fpar"),
        });
    }

    const dataset = ee
        .ImageCollection("MODIS/061/MCD15A3H")
        .filter(ee.Filter.date(START_DATE, END_DATE));

    const indices = dataset.select(["Lai", "Fpar"]);
    const sampled = indices.map(sampleIndices);
    const sampledFc = ee.FeatureCollection(sampled);

    return new Promise((resolve, reject) => {
        sampledFc.evaluate((result, error) => {
            if (error) {
                console.error("Error evaluating sampled FeatureCollection:", error);
                reject(error);
            } else {
                const features = result.features || [];
                if (features.length > 0) {
                    const laiValue = features[0].properties.LAI || null;
                    const fparValue = features[0].properties.FPAR || null;
                    resolve([laiValue, fparValue]);
                } else {
                    resolve([null, null]);
                }
            }
        });
    });
}


async function elevation(LATITUDE, LONGITUDE) {
    const url = "https://api.open-meteo.com/v1/elevation";
    
    const params = new URLSearchParams({
        latitude: LATITUDE,
        longitude: LONGITUDE
    });
    
    try {
        const response = await fetch(`${url}?${params}`);
        
        if (response.ok) {
            const data = await response.json();
            
            if ('elevation' in data) {
                return data.elevation;
            } else {
                console.log("Elevation data not found in the response.");
                return null;
            }
        } else {
            console.log(`Error: ${response.status}`);
            return null;
        }
    } catch (error) {
        console.log("Error fetching the data:", error);
        return null;
    }
}

async function weather_Data(latitude, longitude) {
    const url = "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
        latitude: latitude,
        longitude: longitude,
        hourly: [
            "relative_humidity_2m",
            "dew_point_2m",
            "surface_pressure",
            "cloud_cover",
            "wind_speed_10m",
            "soil_temperature_0cm",
            "soil_temperature_6cm",
            "soil_moisture_0_to_1cm",
            "soil_moisture_1_to_3cm",
            "soil_moisture_3_to_9cm",
            "direct_radiation",
        ].join(","),
        daily: [
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "rain_sum",
            "wind_speed_10m_max",
            "et0_fao_evapotranspiration",
        ].join(","),
        timezone: "Asia/Kolkata"
    });

    try {
        const response = await fetch(`${url}?${params}`);
        if (!response.ok) {
            console.error(`Error: Failed to fetch weather data. Status: ${response.status}`);
            return null;
        }
        const data = await response.json();

        const hourly = data.hourly;
        const daily = data.daily;

        function calculateDailyMeans(variable) {
            if (!variable) return new Array(7).fill(null);
            const dailyMeans = [];
            for (let i = 0; i < 7; i++) {
                const start = i * 24;
                const end = start + 24;
                const slice = variable.slice(start, end);
                dailyMeans.push(slice.reduce((a, b) => a + b, 0) / 24);
            }
            return dailyMeans;
        }

        return {
            relative_humidity: calculateDailyMeans(hourly.relative_humidity_2m),
            dew_point: calculateDailyMeans(hourly.dew_point_2m),
            surface_pressure: calculateDailyMeans(hourly.surface_pressure),
            cloud_cover: calculateDailyMeans(hourly.cloud_cover),
            wind_speed: calculateDailyMeans(hourly.wind_speed_10m),
            soil_temperature: calculateDailyMeans(hourly.soil_temperature_0cm).map(
                (value, index) => (value + calculateDailyMeans(hourly.soil_temperature_6cm)[index]) / 2
            ),
            soil_moisture: calculateDailyMeans(hourly.soil_moisture_0_to_1cm).map(
                (value, index) =>
                    (value +
                        calculateDailyMeans(hourly.soil_moisture_1_to_3cm)[index] +
                        calculateDailyMeans(hourly.soil_moisture_3_to_9cm)[index]) / 2
            ),
            direct_radiation: calculateDailyMeans(hourly.direct_radiation),
            weather_code: daily.weather_code,
            temperature: daily.temperature_2m_max,
            rain_sum: daily.rain_sum,
            evapotranspiration: daily.et0_fao_evapotranspiration,
        };
    } catch (error) {
        console.error("Error fetching weather data:", error);
        return null;
    }
}

async function getDistrictData(id) {
    try {
        const fileContent = await readDocument(String(id));

        var district_data = []
        for (let i = 0; i < 7; i++) {
            let dataKey = "data" + i;
            district_data.push(fileContent[dataKey])
        }

        return district_data;
    } catch (error) {
        console.error("Error reading or parsing JSON file:", error);
        return null;
    }
}


async function getData(latitude, longitude) {
    function getDateRange(i) {
        let now = new Date();
        now.setDate(now.getDate() + i);
    
        let options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }; 
        let formatter = new Intl.DateTimeFormat('en-GB', options); 
    
        let parts = formatter.formatToParts(now); 
        let day = parts.find(part => part.type === 'day').value; 
        let month = parts.find(part => part.type === 'month').value; 
        let year = parts.find(part => part.type === 'year').value; 
    
        return `${year}-${month}-${day}`; 
    }

    const currentDate = getDateRange(0);

    function getNextSevenDaysMonths() {
        const dates = [];
        for (let i = 0; i < 7; i++) {
            var nextDate = getDateRange(i)
            dates.push(parseInt(nextDate.split("-")[1]));
        }
        return dates;
    }

    const thirtyDaysBefore =  getDateRange(-60);
    const tenDaysBefore = getDateRange(-20);

    try {
        const [locationNDVI, locationEVI] = (await vegetationtypeNdviEvi(latitude, longitude, thirtyDaysBefore, currentDate)) || [null, null];
        const [locationLAI, locationFPAR] = (await vegetationtypeLaiFpar(latitude, longitude, tenDaysBefore, currentDate)) || [null, null];
        const locationElevation = await elevation(latitude, longitude) || null;
        const weatherDataResponse = await weather_Data(latitude, longitude);

        const weatherData = weatherDataResponse || {};
        const locationRelativeHumidity = weatherData.relative_humidity || new Array(7).fill(null);
        const locationDewPoint = weatherData.dew_point || new Array(7).fill(null);
        const locationSurfacePressure = weatherData.surface_pressure || new Array(7).fill(null);
        const locationCloudCover = weatherData.cloud_cover || new Array(7).fill(null);
        const locationWindSpeed = weatherData.wind_speed || new Array(7).fill(null);
        const locationSoilTemperature = weatherData.soil_temperature || new Array(7).fill(null);
        const locationSoilMoisture = weatherData.soil_moisture || new Array(7).fill(null);
        const locationDirectRadiation = weatherData.direct_radiation || new Array(7).fill(null);
        const locationWeatherCode = weatherData.weather_code || new Array(7).fill(null);
        const locationTemperature = weatherData.temperature || new Array(7).fill(null);
        const locationRainSum = weatherData.rain_sum || new Array(7).fill(null);
        const locationEvapotranspiration = weatherData.evapotranspiration || new Array(7).fill(null);

        return {
            longitude: new Array(7).fill(longitude),
            latitude: new Array(7).fill(latitude),
            months: getNextSevenDaysMonths(),
            ndvi: new Array(7).fill(locationNDVI),
            evi: new Array(7).fill(locationEVI),
            lai: new Array(7).fill(locationLAI),
            fpar: new Array(7).fill(locationFPAR),
            elevation: new Array(7).fill(locationElevation[0]),
            relative_humidity: locationRelativeHumidity,
            dew_point: locationDewPoint,
            surface_pressure: locationSurfacePressure,
            cloud_cover: locationCloudCover,
            wind_speed: locationWindSpeed,
            soil_temperature: locationSoilTemperature,
            soil_moisture: locationSoilMoisture,
            direct_radiation: locationDirectRadiation,
            weather_code: locationWeatherCode,
            temperature: locationTemperature,
            rain_sum: locationRainSum,
            evapotranspiration: locationEvapotranspiration,
        };
    } catch (error) {
        console.error("Error fetching data:", error);
        return null;
    }
}

app.use(express.json());
app.use(cors());

router.get('/', (req, res) => {
    res.send('App is running..');
});

router.get('/getLocationData', async (req, res) => {
    const { locationLatitude, locationLongitude } = req.query;

    if (!locationLatitude || !locationLongitude) {
        return res.status(400).send('Latitude and Longitude are required');
    }
    try {
        const data = await getData(parseFloat(locationLatitude), parseFloat(locationLongitude));
		const groupedData = Array.from({ length: 7 }, () => []);
		Object.keys(data).forEach((key) => {
			data[key].forEach((value, index) => {
				groupedData[index].push(value);
			});
		});
        res.json(groupedData);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

router.get('/getDistrictData', async (req, res) => {
    const { districtID } = req.query;

    if (!districtID) {
        return res.status(400).send('District ID required.');
    }
    try {
        const data = await getDistrictData(parseInt(districtID));
        res.json(data);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    }
});

initializeEarthEngine();

app.use('/.netlify/functions/api', router);
module.exports.handler = serverless(app);