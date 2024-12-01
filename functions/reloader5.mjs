import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import fs from "fs/promises";
import path from "path";

const geojsonPath = path.join(__dirname, "tmp", "india_districts.geojson");

const firebaseConfig = process.env.YOU_WISH;

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const collectionName = "DistrictData";

async function readDocument(documentId) {
    try {
        const docRef = doc(db, collectionName, documentId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data();
        } else {
            console.log("No such document!");
            return null;
        }
    } catch (error) {
        console.error("Error reading document:", error);
        throw error;
    }
}

async function writeDocument(documentId, data) {
    try {
        const docRef = doc(db, collectionName, String(documentId));
        await setDoc(docRef, data);
        console.log(`Document written successfully with ID '${documentId}'`);
    } catch (error) {
        console.error("Error writing document:", error);
    }
}

function getDateRange(offset) {
    const now = new Date();
    now.setDate(now.getDate() + offset);

    const options = { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" };
    const formatter = new Intl.DateTimeFormat("en-GB", options);

    const parts = formatter.formatToParts(now);
    const day = parts.find((part) => part.type === "day").value;
    const month = parts.find((part) => part.type === "month").value;
    const year = parts.find((part) => part.type === "year").value;

    return `${year}-${month}-${day}`;
}

async function processGeoJSON(districtNumber5) {
    try {
        const geojsonContent = await fs.readFile(geojsonPath, "utf8");
        const geojsonData = JSON.parse(geojsonContent);

        const currentDate = getDateRange(0);
        const districtFeature = geojsonData.features[districtNumber5 - 1];

        const { default: turfCentroid } = await import("@turf/centroid");
        const districtCentre = turfCentroid(districtFeature).geometry.coordinates;
        const [longitude, latitude] = districtCentre;

        const previousData = await readDocument(String(districtNumber5));
        if (previousData?.date === currentDate) {
            console.log(`District ${districtFeature.properties.dtname} already has the latest data.`);
            return;
        }

        const response = await fetch(`https://pyropredictor.netlify.app/.netlify/functions/api/getLocationData?locationLatitude=${latitude}&locationLongitude=${longitude}`);
        const groupedData = await response.json();

        if (!groupedData) {
            console.log(`Skipping district ${districtFeature.properties.dtname} due to missing data.`);
            return;
        }

        const newDistrictData = {
            id: districtFeature.id,
            name: districtFeature.properties.dtname,
            latitude,
            longitude,
            data0: groupedData[0],
            data1: groupedData[1],
            data2: groupedData[2],
            data3: groupedData[3],
            data4: groupedData[4],
            data5: groupedData[5],
            data6: groupedData[6],
            date: currentDate,
        };

        await writeDocument(districtFeature.id, newDistrictData);
    } catch (error) {
        console.error(`Error processing district ${districtNumber5}:`, error.message);
    }
}

export default async (req) => {
    try {
        let { districtNumber5 } = (await readDocument("districtNumber5")) || { districtNumber5: 5 };
        await processGeoJSON(districtNumber5);
        await writeDocument("districtNumber5", { districtNumber5 });

        districtNumber5 += 5
        districtNumber5 = (districtNumber5 - 1) % 755 + 1;
        
        await writeDocument("districtNumber5", { districtNumber5 });
    } catch (error) {
        console.error("Error in scheduled process:", error);
    }
};