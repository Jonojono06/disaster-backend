const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
const webPush = require('web-push');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGO_URI;
const nasaMapKey = process.env.nasa_mapkey;
const Public_Key = process.env.Public_Key;
const Private_Key = process.env.Private_Key;

const vapidKeys = {
    publicKey: Public_Key,
    privateKey: Private_Key,
  };

  webPush.setVapidDetails('mailto:your-email@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

  let pushSubscriptions = []; // Store subscriptions
// List of U.S. state abbreviations
const usStates = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 
  'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

app.use(cors());

// Connect to MongoDB Atlas
const client = new MongoClient(mongoUri);
let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db('disasterDB');
    console.log('Connected to MongoDB Atlas');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

// Fetch and Save Earthquakes from USGS
async function fetchEarthquakes() {
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  let earthquakes = [];

  try {
    const eqResponse = await axios.get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson');
    earthquakes = eqResponse.data.features.map(feature => {
      const place = feature.properties.place;
      const parts = place.split(',').map(part => part.trim());
      let country = parts.length > 1 ? parts[parts.length - 1] : 'Unknown';
      
      // Check if the last part is a U.S. state
      if (usStates.includes(country.toUpperCase())) {
        country = 'United States';
      }

      return {
        id: feature.id,
        type: 'earthquake',
        location: place,
        country,
        magnitude: feature.properties.mag,
        time: new Date(feature.properties.time),
      };
    });

    const existingEqIds = (await db.collection('earthquakes').find({}, { projection: { id: 1 } }).toArray()).map(doc => doc.id);
    const newEarthquakes = earthquakes.filter(eq => !existingEqIds.includes(eq.id));

    if (newEarthquakes.length > 0) {
      await db.collection('earthquakes').insertMany(newEarthquakes);
      console.log(`Inserted ${newEarthquakes.length} new earthquakes`);
      io.emit('newEarthquakes', newEarthquakes);
    }

    await db.collection('earthquakes').deleteMany({ time: { $lt: twoDaysAgo } });
  } catch (error) {
    console.error('Error fetching/storing earthquakes:', error);
  }
}

// Fetch Earthquakes from MongoDB
async function fetchDBEarthquakes() {
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  try {
    return await db.collection('earthquakes')
      .find({ time: { $gte: twoDaysAgo } })
      .sort({ time: -1 })
      .toArray();
  } catch (error) {
    console.error('Error fetching earthquakes from DB:', error);
    return [];
  }
}

// Fetch and Save Fires from NASA FIRMS
// async function fetchFires() {
//   const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
//   let fires = [];

//   try {
//     const fireResponse = await axios.get(`https://firms.modaps.eosdis.nasa.gov/api/area/json/${nasaMapKey}/VIIRS_SNPP_NRT/world/1`);
//     fires = fireResponse.data.map(fire => {
//       return {
//         id: `${fire.latitude}-${fire.longitude}-${fire.acq_date}`,
//         type: 'fire',
//         location: `${fire.latitude}, ${fire.longitude}`,
//         country: 'Fetching...',
//         severity: fire.confidence > 80 ? 'high' : 'medium',
//         time: new Date(fire.acq_date),
//       };
//     });

//     for (let fire of fires) {
//       try {
//         const geoResponse = await axios.get(`https://nominatim.openstreetmap.org/reverse?lat=${fire.location.split(',')[0]}&lon=${fire.location.split(',')[1]}&format=json`);
//         fire.country = geoResponse.data.address?.country || 'Unknown';
//       } catch (error) {
//         fire.country = 'Unknown';
//         console.error('Error geocoding fire:', error.message);
//       }
//     }

//     const existingFireIds = (await db.collection('fires').find({}, { projection: { id: 1 } }).toArray()).map(doc => doc.id);
//     const newFires = fires.filter(fire => !existingFireIds.includes(fire.id));

//     if (newFires.length > 0) {
//       await db.collection('fires').insertMany(newFires);
//       console.log(`Inserted ${newFires.length} new fires`);
//       io.emit('newFires', newFires);
//     }

//     await db.collection('fires').deleteMany({ time: { $lt: twoDaysAgo } });
//   } catch (error) {
//     console.error('Error fetching/storing fires:', error);
//   }
// }

// Fetch Fires from MongoDB
// async function fetchDBFires() {
//   const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
//   try {
//     return await db.collection('fires')
//       .find({ time: { $gte: twoDaysAgo } })
//       .sort({ time: -1 })
//       .toArray();
//   } catch (error) {
//     console.error('Error fetching fires from DB:', error);
//     return [];
//   }
// }

// Start Background Updates After DB Connection
async function startBackgroundUpdates() {
  await connectDB();
  fetchEarthquakes();
//   fetchFires();
  setInterval(() => {
    fetchEarthquakes();
    // fetchFires();
  }, 60000); // Every minute
}

startBackgroundUpdates();

// API Endpoints
app.get('/api/disaster/earthquakes', async (req, res) => {
  try {
    const earthquakes = await fetchDBEarthquakes();
    res.json(earthquakes);
  } catch (error) {
    console.error('Error in /api/disaster/earthquakes:', error);
    res.status(500).json({ error: 'Failed to fetch earthquakes' });
  }
});

// app.get('/api/disaster/fires', async (req, res) => {
//   try {
//     const fires = await fetchDBFires();
//     res.json(fires);
//   } catch (error) {
//     console.error('Error in /api/disaster/fires:', error);
//     res.status(500).json({ error: 'Failed to fetch fires' });
//   }
// });

app.post('/subscribe', (req, res) => {
    const subscription = req.body;
    pushSubscriptions.push(subscription);
    res.status(201).json({ success: true });
  });

server.listen(port, () => console.log(`Backend running on port ${port}`));