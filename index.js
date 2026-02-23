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
  if (!authHeader) {
    return res.status(401).send({
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
      return res.status(401).send({
        success: false,
        error: "User not found in database",
        code: "USER_NOT_FOUND",
      });
    }

    if (user.status === "blocked") {
      return res.status(403).send({
        success: false,
        error: "Your account has been blocked",
        code: "ACCOUNT_BLOCKED",
      });
    }

    // Attach user data to request
    req.decoded_user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: user.role,
    };

    next();
  } catch (error) {
    console.error("Token verification error:", error);

    if (error.code === "auth/id-token-expired") {
      return res.status(401).send({
        success: false,
        error: "Token expired",
        code: "TOKEN_EXPIRED",
      });
    }

    return res.status(401).send({
      success: false,
      error: "Invalid token",
      code: "INVALID_TOKEN",
    });
  }
};

// middlewares/verifyRole.js
const verifyRole = (allowedRoles) => {
  return (req, res, next) => {
    // Check if user exists (verifyToken already ran)
    if (!req.decoded_user) {
      return res.status(401).send({
        success: false,
        error: "Authentication required",
      });
    }

    // Check if user's role is in allowed roles
    if (!allowedRoles.includes(req.decoded_user.role)) {
      return res.status(403).send({
        success: false,
        error: "Access denied. Insufficient permissions.",
      });
    }

    next();
  };
};

export default verifyRole;

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
    const { email } = req.body;

    // Check if user exists in database
    const existingUser = await usersCollection.findOne({ email });

    if (!existingUser) {
      return res.status(404).send({
        success: false,
        error: "No account found with this email. Please register first.",
        code: "USER_NOT_FOUND",
      });
    }

    // User exists - just return success with user data
    console.log(`✅ Google login successful for existing user: ${email}`);

    res.send({
      success: true,
      message: "Login successful",
      data: existingUser,
    });
  } catch (error) {
    console.error("Google login error:", error);
    res.status(500).json({
      success: false,
      error: "Google login failed",
    });
  }
});

// ============= Profile APIs =============

// GET current user profile (protected)
app.get("/api/users/profile", verifyToken, async (req, res) => {
  const email = req.query.email;
  const decoded_email = req.decoded_user?.email;

  try {
    // Verify email matches
    if (email !== decoded_email) {
      return res.status(401).send({
        success: false,
        error: "Forbidden access",
        code: "UNAUTHORIZED_ACCESS",
      });
    }
    const user = await usersCollection.findOne(
      { email: email },
      {
        projection: {
          password: 0,
          firebaseUID: 0,
        },
      },
    );

    if (!user) {
      return res.status(404).send({
        success: false,
        error: "User not found",
      });
    }

    res.send({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// UPDATE user profile (protected)
app.put("/api/users/profile", verifyToken, async (req, res) => {
  try {
    const email = req.query.email;
    const decoded_email = req.decoded_user?.email;

    // Verify email matches
    if (email !== decoded_email) {
      return res.status(401).send({
        success: false,
        error: "Forbidden access",
        code: "UNAUTHORIZED_ACCESS",
      });
    }

    const { name, phone, photoURL, location, bio, whatsapp } = req.body;

    // Build update object based on user role
    const updateData = {
      name,
      phone,
      photoURL,
      location,
      bio,
      whatsapp,
      updatedAt: new Date(),
    };

    // Add role-specific fields
    if (req.decoded_user.role === "tutor") {
      const { qualifications, subjects, experience, hourlyRate, availability } =
        req.body;

      if (qualifications) updateData.qualifications = qualifications;
      if (subjects) updateData.subjects = subjects;
      if (experience) updateData.experience = experience;
      if (hourlyRate) updateData.hourlyRate = hourlyRate;
      if (availability) updateData.availability = availability;
    } else if (req.decoded_user.role === "student") {
      const { preferredSubjects, class: studentClass } = req.body;

      if (preferredSubjects) updateData.preferredSubjects = preferredSubjects;
      if (studentClass) updateData.class = studentClass;
    }

    const result = await usersCollection.updateOne(
      { email },
      { $set: updateData },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        error: "User not found",
      });
    }

    // Get updated user data
    const updatedUser = await usersCollection.findOne(
      { email },
      {
        projection: {
          password: 0,
          firebaseUID: 0,
        },
      },
    );

    console.log(`✅ Profile updated for: ${email}`);
    res.send({
      success: true,
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// GET user statistics based on role
app.get("/api/users/stats", verifyToken, async (req, res) => {
  try {
    const stats = {};

    if (req.decoded_user.role === "tutor") {
      // Get tutor statistics
      const [totalApplications, acceptedApplications, totalEarnings] =
        await Promise.all([
          applicationsCollection.countDocuments({
            tutorId: req.decoded_user.uid,
          }),
          applicationsCollection.countDocuments({
            tutorId: req.decoded_user.uid,
            status: "accepted",
          }),
          paymentsCollection
            .aggregate([
              {
                $match: {
                  tutorId: req.decoded_user.uid,
                  status: "completed",
                },
              },
              {
                $group: {
                  _id: null,
                  total: { $sum: "$amount" },
                },
              },
            ])
            .toArray(),
        ]);

      stats.applications = totalApplications;
      stats.acceptedApplications = acceptedApplications;
      stats.totalEarnings = totalEarnings[0]?.total || 0;

      // Get ongoing tuitions count
      stats.ongoingTuitions = await tuitionsCollection.countDocuments({
        tutorId: req.decoded_user.uid,
        status: "ongoing",
      });
    } else if (req.decoded_user.role === "student") {
      // Get student statistics
      const [totalTuitions, activeTuitions, totalPayments] = await Promise.all([
        tuitionsCollection.countDocuments({
          studentId: req.decoded_user.uid,
        }),
        tuitionsCollection.countDocuments({
          studentId: req.decoded_user.uid,
          status: "ongoing",
        }),
        paymentsCollection
          .aggregate([
            {
              $match: {
                studentId: req.decoded_user.uid,
                status: "completed",
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" },
              },
            },
          ])
          .toArray(),
      ]);

      stats.totalTuitions = totalTuitions;
      stats.activeTuitions = activeTuitions;
      stats.totalPayments = totalPayments[0]?.total || 0;

      // Get applications count for student's tuitions
      const studentTuitions = await tuitionsCollection
        .find({ studentId: req.decoded_user.uid }, { projection: { _id: 1 } })
        .toArray();

      const tuitionIds = studentTuitions.map((t) => t._id);

      stats.totalApplications = await applicationsCollection.countDocuments({
        tuitionPostId: { $in: tuitionIds },
      });
    }

    res.send({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// GET user activity (recent applications/posts)
app.get("/api/users/activity", verifyToken, async (req, res) => {
  try {
    const { limit = 5, email } = req.query;
    const decoded_email = req.decoded_user?.email;
    if (!email === decoded_email) {
      return res.status(401).send({
        success: false,
        error: "Forbidden access",
        code: "UNAUTHORIZED_ACCESS",
      });
    }
    const user = await usersCollection.findOne({ email });
    console.log(limit, email, decoded_email);
    let activity = [];

    if (user.role === "tutor") {
      // Get recent applications for tutor
      activity = await applicationsCollection
        .aggregate([
          { $match: { tutorId: user._id } },
          { $sort: { appliedAt: -1 } },
          { $limit: parseInt(limit) },
          {
            $lookup: {
              from: "tuitions",
              localField: "tuitionPostId",
              foreignField: "_id",
              as: "tuition",
            },
          },
          { $unwind: "$tuition" },
          {
            $project: {
              _id: 1,
              type: "application",
              title: "$tuition.title",
              subject: "$tuition.subject",
              class: "$tuition.class",
              status: 1,
              date: "$appliedAt",
              tuitionId: "$tuitionPostId",
            },
          },
        ])
        .toArray();
    } else if (user.role === "student") {
      // Get recent tuition posts for student
      activity = await tuitionsCollection
        .find(
          { studentId: user._id },
          {
            projection: {
              _id: 1,
              type: "tuition",
              title: 1,
              subject: 1,
              class: 1,
              status: 1,
              date: "$posted",
            },
          },
        )
        .sort({ posted: -1 })
        .limit(parseInt(limit))
        .toArray();
    }

    res.send({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error("Error fetching activity:", error);
    res.status(500).send({
      success: false,
      error: error.message,
    });
  }
});

// DELETE account (soft delete)
app.delete("/api/users/profile", verifyToken, async (req, res) => {
  try {
    const { reason } = req.body;

    // Soft delete - just mark as deleted
    const result = await usersCollection.updateOne(
      { email: req.user.email },
      {
        $set: {
          status: "deleted",
          deletedAt: new Date(),
          deletionReason: reason || "User requested",
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        error: "User not found",
      });
    }

    console.log(`✅ Account deleted for: ${req.user.email}`);
    res.send({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting account:", error);
    res.status(500).send({
      success: false,
      error: error.message,
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
