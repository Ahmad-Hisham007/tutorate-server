import "dotenv/config";
import express, { json } from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import admin from "firebase-admin";

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
    }),
  });
  console.log("✅ Firebase Admin initialized");
} catch (error) {
  console.log("Firebase Admin error:", error.message);
}

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(json());

// Middleware to verify token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res.status(401).send({ error: "Invalid or expired token" });
  }
};

// MongoDB connection
const uri = process.env.MONGO_URI;

// Create MongoDB client
const client = new MongoClient(uri, {
  family: 4,
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 30000,
});

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    console.log("Connecting to MongoDB...");
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
  }
}

const db = client.db("tutorate");

// Collections
const usersCollection = db.collection("users");
const tuitionsCollection = db.collection("tuitions");
const applicationsCollection = db.collection("applications");
const paymentsCollection = db.collection("payments");

// Indexes for better performance
async function createIndexes() {
  try {
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await usersCollection.createIndex({ role: 1 });
    await tuitionsCollection.createIndex({ studentId: 1 });
    await tuitionsCollection.createIndex({ status: 1 });
    await applicationsCollection.createIndex({ tuitionPostId: 1 });
    await applicationsCollection.createIndex({ tutorId: 1 });
    await applicationsCollection.createIndex({ status: 1 });
    console.log("✅ Indexes created successfully");
  } catch (error) {
    console.log("Index creation error:", error.message);
  }
}

// Routes
app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Tutors API
// GET all tutors (public route)
app.get("/api/tutors", async (req, res) => {
  try {
    const tutors = await usersCollection
      .find({
        role: "tutor",
        status: "active",
      })
      .project({
        password: 0, // exclude password
        firebaseUID: 0, // exclude firebase UID
      })
      .sort({ rating: -1, totalReviews: -1 }) // sort by rating and reviews
      .toArray();

    res.send({
      success: true,
      count: tutors.length,
      data: tutors,
    });
  } catch (error) {
    console.error("Error fetching tutors:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// GET single tutor by ID
app.get("/api/tutors/:id", async (req, res) => {
  try {
    const tutor = await usersCollection.findOne(
      {
        _id: new ObjectId(req.params.id),
        role: "tutor",
      },
      {
        projection: {
          password: 0,
          firebaseUID: 0,
        },
      },
    );

    if (!tutor) {
      return res.status(404).send({
        success: false,
        error: "Tutor not found",
      });
    }

    res.send({
      success: true,
      data: tutor,
    });
  } catch (error) {
    console.error("Error fetching tutor:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// GET featured tutors for home page (limited)
app.get("/api/tutors/featured", async (req, res) => {
  try {
    const tutors = await usersCollection
      .find({
        role: "tutor",
        status: "active",
        rating: { $gte: 4.5 }, // only highly rated tutors
      })
      .project({
        password: 0,
        firebaseUID: 0,
        // Include only needed fields for home page
        name: 1,
        photoURL: 1,
        location: 1,
        rating: 1,
        totalReviews: 1,
        hourlyRate: 1,
        subjects: 1,
        qualifications: 1,
        isVerified: 1,
      })
      .sort({ rating: -1, totalReviews: -1 })
      .limit(8) // limit to 8 tutors for home page
      .toArray();

    res.send({
      success: true,
      count: tutors.length,
      data: tutors,
    });
  } catch (error) {
    console.error("Error fetching featured tutors:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// Tutors API
// GET all tutors (public route)
app.get("/api/tuitions", async (req, res) => {
  try {
    const tuitions = await tuitionsCollection.find().toArray();

    res.send({
      success: true,
      count: tuitions.length,
      data: tuitions,
    });
  } catch (error) {
    console.error("Error fetching tuitions:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

//insert sample data

// Insert function
// async function insertTutors() {
//   try {
//     // Check if tutors already exist
//     const existingTutors = await usersCollection.countDocuments({
//       role: "tutor",
//     });

//     if (existingTutors === 0) {
//       const result = await usersCollection.insertMany(tutorsData);
//       console.log(`✅ ${result.insertedCount} tutors inserted successfully`);
//     } else {
//       console.log(
//         `⏩ Tutors already exist (${existingTutors} found), skipping insertion`,
//       );
//     }
//   } catch (error) {
//     console.log("Tutor insertion error:", error.message);
//   }
// }

// Start server and connect to database
app.listen(port, async () => {
  console.log(`🚀 Server listening on port ${port}`);
  console.log(`📍 Health check: http://localhost:${port}/health`);

  try {
    // Connect to MongoDB first
    await connectToMongoDB();

    // Then create indexes
    await createIndexes();

    // // Then insert sample data (only if collection is empty)
    // await insertTutors();

    console.log("✅ Server setup complete!");
  } catch (error) {
    console.error("❌ Server setup error:", error.message);
  }
});
