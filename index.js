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

// ============= TOKEN VERIFICATION MIDDLEWARE =============

// Verify Firebase token middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "No token provided",
      code: "NO_TOKEN",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verify the Firebase token
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Get user from MongoDB using email from token
    const user = await usersCollection.findOne({ email: decodedToken.email });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found in database",
        code: "USER_NOT_FOUND",
      });
    }

    if (user.status === "blocked") {
      return res.status(403).json({
        success: false,
        error: "Your account has been blocked",
        code: "ACCOUNT_BLOCKED",
      });
    }

    // Attach user data to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: user.name,
      role: user.role,
      status: user.status,
      userId: user._id.toString(),
      photoURL: user.photoURL,
    };

    next();
  } catch (error) {
    console.error("Token verification error:", error);

    if (error.code === "auth/id-token-expired") {
      return res.status(401).json({
        success: false,
        error: "Token expired",
        code: "TOKEN_EXPIRED",
      });
    }

    return res.status(401).json({
      success: false,
      error: "Invalid token",
      code: "INVALID_TOKEN",
    });
  }
};

// Role verification middleware
const verifyRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      console.warn(
        `Security: User ${req.user.email} with role ${req.user.role} attempted to access ${req.originalUrl}`,
      );

      return res.status(403).json({
        success: false,
        error: "Forbidden: Insufficient permissions",
        code: "INSUFFICIENT_PERMISSIONS",
        requiredRole: allowedRoles,
      });
    }

    next();
  };
};

// MongoDB connection

const uri = process.env.MONGO_URI_TEST;

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

// ============= Frontend APIs =============

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

// Tuitions API
// GET all tuitions with search, filters and sorting
app.get("/api/tuitions", async (req, res) => {
  try {
    const {
      search,
      location,
      subject,
      class: className,
      sortBy = "newest",
      page = 1,
      limit = 4,
    } = req.query;

    // Build filter
    const filter = { status: "active" };

    // Search
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { institution: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Location
    if (location) {
      filter.$or = filter.$or || [];
      filter.$or.push(
        { location: { $regex: location, $options: "i" } },
        { area: { $regex: location, $options: "i" } },
      );
    }

    // Subject
    if (subject) {
      filter.subject = { $regex: subject, $options: "i" };
    }

    // Class
    if (className) {
      filter.class = { $regex: className, $options: "i" };
    }

    // Sorting
    let sort = {};
    if (sortBy === "budget-low") sort = { minBudget: 1 };
    else if (sortBy === "budget-high") sort = { minBudget: -1 };
    else if (sortBy === "newest") sort = { posted: -1 };
    else if (sortBy === "oldest") sort = { posted: 1 };
    else if (sortBy === "top-rated") sort = { applicants: -1 };
    else sort = { posted: -1 };

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get data
    const tuitions = await tuitionsCollection
      .find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const totalCount = await tuitionsCollection.countDocuments(filter);

    res.send({
      success: true,
      data: tuitions,
      total: totalCount,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
    });
  } catch (error) {
    res.status(500).send({ success: false, error: error.message });
  }
});

// GET single tuition by ID
app.get("/api/tuitions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate if the ID is a valid ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        error: "Invalid tuition ID format",
      });
    }

    const tuition = await tuitionsCollection.findOne({
      _id: new ObjectId(id),
      status: "active", // Only return active tuitions
    });

    if (!tuition) {
      return res.status(404).send({
        success: false,
        error: "Tuition post not found",
      });
    }
    res.send({
      success: true,
      data: tuition,
    });
  } catch (error) {
    console.error("Error fetching tuition:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// ============= Backend APIs =============
// Register new user
app.post("/api/users", async (req, res) => {
  try {
    const { name, email, phone, photoURL, role, uid } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !role || !uid) {
      return res.status(400).send({
        success: false,
        error: "All fields are required",
      });
    }

    // Validate role
    if (!["student", "tutor"].includes(role)) {
      return res.status(400).send({
        success: false,
        error: "Invalid role selected",
      });
    }

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).send({
        success: false,
        error: "User with this email already exists",
      });
    }

    // Prepare user document for MongoDB
    const newUser = {
      uid, // Firebase UID
      name,
      email,
      phone,
      photoURL:
        photoURL ||
        `https://ui-avatars.com/api/?name=${name}&background=random`,
      role,
      status: role === "tutor" ? "pending" : "active", // Tutors need admin approval
      isVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),

      // Tutor specific fields (optional for tutors)
      ...(role === "tutor" && {
        qualifications: req.body.qualifications || [],
        subjects: req.body.subjects || [],
        experience: req.body.experience || 0,
        bio: req.body.bio || "",
        hourlyRate: req.body.hourlyRate || 0,
        location: req.body.location || "",
        availability: req.body.availability || {},
        whatsapp: req.body.whatsapp || "",
        rating: 0,
        totalReviews: 0,
      }),

      // Student specific fields
      ...(role === "student" && {
        preferredSubjects: req.body.preferredSubjects || [],
        class: req.body.class || "",
      }),
    };

    // Save to MongoDB and return the result directly
    const result = await usersCollection.insertOne(newUser);

    console.log(`✅ New user registered: ${email} as ${role}`);

    // Send the MongoDB result directly
    res.status(201).send(result);
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      error: "Registration failed. Please try again.",
    });
  }
});

// Google Login - Create or Update user
app.post("/api/users/google", async (req, res) => {
  try {
    const { email, name, photoURL, uid } = req.body;

    // Check if user exists
    let user = await usersCollection.findOne({ email });

    if (!user) {
      // Create new user with student role by default
      const newUser = {
        uid,
        name,
        email,
        phone: "",
        photoURL:
          photoURL ||
          `https://ui-avatars.com/api/?name=${name}&background=random`,
        role: "student",
        status: "active",
        isVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        preferredSubjects: [],
        class: "",
      };

      // Insert and return the result
      const result = await usersCollection.insertOne(newUser);
      console.log(`✅ New user registered: ${email}`);

      // Send the MongoDB result directly
      res.status(201).send(result);
    } else {
      // Update existing user's info
      const result = await usersCollection.updateOne(
        { email },
        {
          $set: {
            name,
            photoURL,
            updatedAt: new Date(),
          },
        },
      );

      console.log(`✅ Google user updated: ${email}`);

      // Send the MongoDB update result directly
      res.send(result);
    }
  } catch (error) {
    console.error("Google login error:", error);
    res.status(500).json({
      success: false,
      error: "Google login failed",
    });
  }
});

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

    // await updateTuitions();

    // await updateBudgets();

    console.log("✅ Server setup complete!");
  } catch (error) {
    console.error("❌ Server setup error:", error.message);
  }
});
