import "dotenv/config";
import express, { json } from "express";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import admin from "firebase-admin";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
// Initialize Firebase Admin
try {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  // Remove quotes if present
  if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
  }
  privateKey = privateKey.replace(/\\n/g, "\n");
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey,
    }),
  });
  console.log("✅ Firebase Admin initialized");
} catch (error) {
  console.log("Firebase Admin error:", error.message);
}

const app = express();
const port = process.env.PORT || 3000;

// ============= MIDDLEWARES =============
// =========================================================
// =========================================================
app.use(cors());
app.use(json());

// TOKEN VERIFICATION MIDDLEWARE

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

// MongoDB connection
app.get("/favicon.ico", (req, res) => {
  res.status(204).end();
});

// Create MongoDB client
const uri = process.env.MONGO_URI;
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
let cachedDb = null;
// Connect to MongoDB
async function connectToMongoDB() {
  if (cachedDb) {
    console.log("✅ Using cached MongoDB connection");
    return cachedDb;
  }

  try {
    console.log("Connecting to MongoDB...");
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");
    cachedDb = client.db("tutorate");
    return cachedDb;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    throw error;
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
// =============================================
// =============================================

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

// ------------------Tuitions API--------------------
// =============================================
// =============================================

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
// =============================================
// =============================================

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
        expectedSalary: req.body.expectedSalary || 0,
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
      const {
        qualifications,
        subjects,
        experience,
        expectedSalary,
        availability,
      } = req.body;

      if (qualifications) updateData.qualifications = qualifications;
      if (subjects) updateData.subjects = subjects;
      if (experience) updateData.experience = experience;
      if (expectedSalary) updateData.expectedSalary = expectedSalary;
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
    const email = req.query.email; // 👈 Add email from query
    const decoded_email = req.decoded_user?.email;

    if (email !== decoded_email) {
      return res.status(401).send({
        success: false,
        error: "Forbidden access",
        code: "UNAUTHORIZED_ACCESS",
      });
    }

    // Get user from MongoDB using email
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).send({
        success: false,
        error: "User not found",
      });
    }

    const stats = {};

    if (user.role === "tutor") {
      // Get tutor statistics using MongoDB _id
      const [totalApplications, acceptedApplications, totalEarnings] =
        await Promise.all([
          applicationsCollection.countDocuments({
            tutorId: user._id, // 👈 Use user._id not uid
          }),
          applicationsCollection.countDocuments({
            tutorId: user._id,
            status: "approved", // 👈 "approved" not "accepted"
          }),
          paymentsCollection
            .aggregate([
              {
                $match: {
                  tutorId: user._id,
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
        tutorId: user._id,
        status: "ongoing",
      });
    } else if (user.role === "student") {
      // Get student statistics using MongoDB _id
      const [totalTuitions, activeTuitions, totalPayments] = await Promise.all([
        tuitionsCollection.countDocuments({
          studentId: user._id, // 👈 Use user._id
        }),
        tuitionsCollection.countDocuments({
          studentId: user._id,
          status: "ongoing",
        }),
        paymentsCollection
          .aggregate([
            {
              $match: {
                studentId: user._id,
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
        .find({ studentId: user._id }, { projection: { _id: 1 } })
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

// ============= Student Post APIs =============
// =============================================
// =============================================

// POST - Create new tuition post (Student only)
app.post(
  "/api/tuitions",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
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

      // Get student's MongoDB document
      const student = await usersCollection.findOne({ email });
      if (!student) {
        return res.status(404).send({
          success: false,
          error: "Student not found",
        });
      }

      const {
        title,
        institution,
        location,
        area,
        type,
        mode,
        subject,
        class: className,
        minBudget,
        maxBudget,
        budgetType,
        schedule,
        requirements,
        qualifications,
        responsibilities,
        benefits,
        students,
        gender,
        experience,
        education,
        description,
        badge,
        badgeColor,
        slots,
        applicationDeadline,
      } = req.body;

      // Validate required fields
      if (
        !title ||
        !subject ||
        !className ||
        !location ||
        !minBudget ||
        !maxBudget ||
        !schedule?.days
      ) {
        return res.status(400).send({
          success: false,
          error: "Please fill in all required fields",
        });
      }

      const newTuition = {
        // Student info
        studentId: student._id,
        studentName: student.name,
        studentEmail: email,

        // Basic Info
        title,
        institution: institution || "",
        location,
        area: area || "",
        type: type || "part-time",
        mode: mode || "on-site",

        // Subject & Class
        subject,
        class: className,

        // Budget
        minBudget: Number(minBudget),
        maxBudget: Number(maxBudget),
        budgetType: budgetType || "BDT",

        // Schedule
        schedule: {
          days: schedule.days,
          hours: schedule.hours || "",
          flexible: schedule.flexible || false,
          startDate: schedule.startDate ? new Date(schedule.startDate) : null,
          duration: schedule.duration || "",
        },

        // Arrays
        requirements: requirements || [],
        qualifications: qualifications || [],
        responsibilities: responsibilities || [],
        benefits: benefits || [],

        // Additional Info
        students: students || "1",
        gender: gender || "any",
        experience: experience || "",
        education: education || "",
        description: description || "",

        // Meta
        badge: badge || "",
        badgeColor: badgeColor || "secondary",
        slots: Number(slots) || 1,
        applicationDeadline: applicationDeadline
          ? new Date(applicationDeadline)
          : null,

        // System fields
        status: "pending", // Admin approval required
        applicants: 0,
        views: 0,
        savedCount: 0,
        posted: new Date(),
        updatedAt: new Date(),
      };

      const result = await tuitionsCollection.insertOne(newTuition);

      console.log(`✅ New tuition posted by: ${email}`);
      res.status(201).send({
        success: true,
        message: "Tuition posted successfully and awaiting admin approval",
        data: { ...newTuition, _id: result.insertedId },
      });
    } catch (error) {
      console.error("Error posting tuition:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// GET - Get student's own tuition posts
app.get(
  "/api/students/my-tuitions",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      console.log("Full request query:", req.query);
      console.log("Email from query:", req.query.email);
      console.log("Decoded user email:", req.decoded_user?.email);
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      console.log("Query email:", email);
      console.log("Decoded email:", decoded_email);

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      const student = await usersCollection.findOne({ email });
      console.log("Student found:", student ? "Yes" : "No");
      console.log("Student ID type:", typeof student?._id);
      if (!student) {
        return res.status(404).send({
          success: false,
          error: "Student not found",
        });
      }

      const { status, page = 1, limit = 10 } = req.query;
      const filter = { studentId: student._id };

      if (status && status !== "all") {
        filter.status = status;
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const tuitions = await tuitionsCollection
        .find(filter)
        .sort({ posted: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await tuitionsCollection.countDocuments(filter);

      res.send({
        success: true,
        data: tuitions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching my tuitions:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// Single tuition for admin and student
app.get(
  "/api/tuitions/:id/student-view",
  verifyToken,
  verifyRole(["student", "admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          success: false,
          error: "Invalid tuition ID format",
        });
      }

      const tuition = await tuitionsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!tuition) {
        return res.status(404).send({
          success: false,
          error: "Tuition post not found",
        });
      }

      const userEmail = req.decoded_user?.email;
      const user = await usersCollection.findOne({ email: userEmail });
      const userRole = user?.role;

      // Admin hole - sob post dekhte parbe
      if (userRole === "admin") {
        return res.send({ success: true, data: tuition });
      }

      // Student hole
      if (userRole === "student") {
        // Case 1: Active post - sob student dekhte parbe
        if (tuition.status === "active") {
          return res.send({ success: true, data: tuition });
        }

        // Case 2: Inactive post - sudhu nijer ta dekhte parbe
        if (tuition.studentId.toString() === user._id.toString()) {
          return res.send({ success: true, data: tuition });
        }

        // Case 3: Onno student er inactive post - access nai
        return res.status(403).send({
          success: false,
          error: "You don't have permission to view this post",
        });
      }

      // Fallback
      return res.status(403).send({
        success: false,
        error: "Forbidden access",
      });
    } catch (error) {
      console.error("Error fetching tuition:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// PUT - Update tuition post (Student only - own posts)
app.put(
  "/api/tuitions/:id",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const tuitionId = req.params.id;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      if (!ObjectId.isValid(tuitionId)) {
        return res.status(400).send({
          success: false,
          error: "Invalid tuition ID",
        });
      }

      // Verify this tuition belongs to the student
      const student = await usersCollection.findOne({ email });
      const existingTuition = await tuitionsCollection.findOne({
        _id: new ObjectId(tuitionId),
        studentId: student._id,
      });

      if (!existingTuition) {
        return res.status(404).send({
          success: false,
          error: "Tuition not found or you don't have permission",
        });
      }

      const {
        title,
        institution,
        location,
        area,
        type,
        mode,
        subject,
        class: className,
        minBudget,
        maxBudget,
        budgetType,
        schedule,
        requirements,
        qualifications,
        responsibilities,
        benefits,
        students,
        gender,
        experience,
        education,
        description,
        badge,
        badgeColor,
        slots,
        applicationDeadline,
        status,
      } = req.body;

      const updateData = {
        title,
        institution,
        location,
        area,
        type,
        mode,
        subject,
        class: className,
        minBudget: Number(minBudget),
        maxBudget: Number(maxBudget),
        budgetType,
        schedule: {
          days: schedule?.days,
          hours: schedule?.hours,
          flexible: schedule?.flexible,
          startDate: schedule?.startDate ? new Date(schedule.startDate) : null,
          duration: schedule?.duration,
        },
        requirements: requirements || [],
        qualifications: qualifications || [],
        responsibilities: responsibilities || [],
        benefits: benefits || [],
        students,
        gender,
        experience,
        education,
        description,
        badge,
        badgeColor,
        slots: Number(slots),
        applicationDeadline: applicationDeadline
          ? new Date(applicationDeadline)
          : null,
        status: status || existingTuition.status,
        updatedAt: new Date(),
      };

      // Remove undefined fields
      Object.keys(updateData).forEach(
        (key) => updateData[key] === undefined && delete updateData[key],
      );

      const result = await tuitionsCollection.updateOne(
        { _id: new ObjectId(tuitionId) },
        { $set: updateData },
      );

      if (result.modifiedCount === 0 && result.matchedCount === 0) {
        return res.status(400).send({
          success: false,
          error: "No changes made",
        });
      }

      const updatedTuition = await tuitionsCollection.findOne({
        _id: new ObjectId(tuitionId),
      });

      console.log(`✅ Tuition updated: ${tuitionId} by ${email}`);
      res.send({
        success: true,
        message: "Tuition updated successfully",
        data: updatedTuition,
      });
    } catch (error) {
      console.error("Error updating tuition:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// DELETE - Delete tuition post (Student only - own posts)
app.delete(
  "/api/tuitions/:id",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const tuitionId = req.params.id;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      if (!ObjectId.isValid(tuitionId)) {
        return res.status(400).send({
          success: false,
          error: "Invalid tuition ID",
        });
      }

      // Verify this tuition belongs to the student
      const student = await usersCollection.findOne({ email });
      const tuition = await tuitionsCollection.findOne({
        _id: new ObjectId(tuitionId),
        studentId: student._id,
      });

      if (!tuition) {
        return res.status(404).send({
          success: false,
          error: "Tuition not found or you don't have permission",
        });
      }

      // ❌ Cannot delete if status is ongoing or completed
      if (tuition.status === "ongoing" || tuition.status === "completed") {
        return res.status(400).send({
          success: false,
          error: "Cannot delete an ongoing or completed tuition",
        });
      }

      // Check if there are any applications
      const applications = await applicationsCollection.countDocuments({
        tuitionPostId: new ObjectId(tuitionId),
      });

      let result;
      if (applications > 0) {
        // Soft delete - just mark as deleted
        result = await tuitionsCollection.updateOne(
          { _id: new ObjectId(tuitionId) },
          {
            $set: {
              status: "deleted",
              deletedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        );
      } else {
        // No applications, hard delete
        result = await tuitionsCollection.deleteOne({
          _id: new ObjectId(tuitionId),
        });
      }

      console.log(`✅ Tuition deleted: ${tuitionId} by ${email}`);
      res.send({
        success: true,
        message: "Tuition deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting tuition:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// GET - Get all applications for a specific tuition (Student only)
app.get(
  "/api/student/tuitions/:tuitionId/applications",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      // Verify tuition belongs to this student
      const student = await usersCollection.findOne({ email });
      const tuition = await tuitionsCollection.findOne({
        _id: new ObjectId(req.params.tuitionId),
        studentId: student._id,
      });

      if (!tuition) {
        return res.status(404).send({
          success: false,
          error: "Tuition not found",
        });
      }

      const applications = await applicationsCollection
        .find({
          tuitionPostId: new ObjectId(req.params.tuitionId),
          status: "pending", // Only show pending applications
        })
        .sort({ appliedAt: -1 })
        .toArray();

      res.send({
        success: true,
        data: applications,
      });
    } catch (error) {
      console.error("Error fetching applications:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// PATCH - Approve/Reject application
app.patch(
  "/api/applications/:applicationId/:action", // action = "approve" or "reject"
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const { applicationId, action } = req.params;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).send({
          success: false,
          error: "Invalid action",
        });
      }

      // Get application and verify tuition ownership
      const application = await applicationsCollection.findOne({
        _id: new ObjectId(applicationId),
      });

      if (!application) {
        return res.status(404).send({
          success: false,
          error: "Application not found",
        });
      }

      // Verify student owns this tuition
      const student = await usersCollection.findOne({ email });
      const tuition = await tuitionsCollection.findOne({
        _id: application.tuitionPostId,
        studentId: student._id,
      });

      if (!tuition) {
        return res.status(403).send({
          success: false,
          error: "You don't have permission",
        });
      }

      if (action === "approve") {
        // Redirect to payment
        res.send({
          success: true,
          message: "Proceed to payment",
          data: {
            applicationId,
            tuitionId: tuition._id,
            tutorId: application.tutorId,
            amount: application.expectedSalary,
          },
        });
      } else {
        // Reject application
        await applicationsCollection.updateOne(
          { _id: new ObjectId(applicationId) },
          { $set: { status: "rejected", updatedAt: new Date() } },
        );
        await tuitionsCollection.updateOne(
          { _id: application.tuitionPostId },
          { $inc: { applicants: -1 } },
        );
        res.send({
          success: true,
          message: "Application rejected successfully",
        });
      }
    } catch (error) {
      console.error("Error processing application:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// ============= Tutor Application APIs =============
// ==================================================
// ==================================================

// POST - Apply to a tuition (Tutor only)
app.post(
  "/api/applications",
  verifyToken,
  verifyRole(["tutor"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      // Email verification
      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      // Get tutor's MongoDB document
      const tutor = await usersCollection.findOne({ email });
      if (!tutor) {
        return res.status(404).send({
          success: false,
          error: "Tutor not found",
        });
      }

      const { tuitionId, qualifications, experience, expectedSalary } =
        req.body;

      // Validate required fields
      if (!tuitionId || !qualifications || !experience || !expectedSalary) {
        return res.status(400).send({
          success: false,
          error: "All fields are required",
        });
      }

      // Check if tuition exists and is active
      if (!ObjectId.isValid(tuitionId)) {
        return res.status(400).send({
          success: false,
          error: "Invalid tuition ID",
        });
      }

      const tuition = await tuitionsCollection.findOne({
        _id: new ObjectId(tuitionId),
        status: "active", // Only active tuitions can be applied to
      });

      if (!tuition) {
        return res.status(404).send({
          success: false,
          error: "Tuition not found or not available for applications",
        });
      }

      // Check if already applied
      const existingApplication = await applicationsCollection.findOne({
        tuitionPostId: new ObjectId(tuitionId),
        tutorId: tutor._id,
      });

      if (existingApplication) {
        return res.status(400).send({
          success: false,
          error: "You have already applied to this tuition",
        });
      }

      // Check if tutor is the one who posted (can't apply to own tuition if student)
      // Actually tutor and student are different collections, so no need

      const newApplication = {
        tuitionPostId: new ObjectId(tuitionId),
        tutorId: tutor._id,
        tutorName: tutor.name,
        tutorEmail: email,
        tutorPhoto: tutor.photoURL,
        qualifications,
        experience: Number(experience),
        expectedSalary: Number(expectedSalary),
        status: "pending", // pending, approved, rejected
        appliedAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await applicationsCollection.insertOne(newApplication);

      // Update tuition applicants count
      await tuitionsCollection.updateOne(
        { _id: new ObjectId(tuitionId) },
        { $inc: { applicants: 1 } },
      );

      console.log(
        `✅ New application by tutor: ${email} for tuition: ${tuitionId}`,
      );

      res.status(201).send({
        success: true,
        message: "Application submitted successfully",
        data: { ...newApplication, _id: result.insertedId },
      });
    } catch (error) {
      console.error("Error submitting application:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// GET - Get my applications (Tutor only)
app.get(
  "/api/applications/my-applications",
  verifyToken,
  verifyRole(["tutor"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      const tutor = await usersCollection.findOne({ email });
      if (!tutor) {
        return res.status(404).send({
          success: false,
          error: "Tutor not found",
        });
      }

      const { status, page = 1, limit = 10 } = req.query;
      const filter = { tutorId: tutor._id };

      if (status && status !== "all") {
        filter.status = status;
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const applications = await applicationsCollection
        .aggregate([
          { $match: filter },
          { $sort: { appliedAt: -1 } },
          { $skip: skip },
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
              tutorId: 1,
              tutorName: 1,
              qualifications: 1,
              experience: 1,
              expectedSalary: 1,
              status: 1,
              appliedAt: 1,
              updatedAt: 1,
              "tuition._id": 1,
              "tuition.title": 1,
              "tuition.subject": 1,
              "tuition.class": 1,
              "tuition.location": 1,
              "tuition.minBudget": 1,
              "tuition.maxBudget": 1,
              "tuition.schedule": 1,
              "tuition.studentName": 1,
            },
          },
        ])
        .toArray();

      const total = await applicationsCollection.countDocuments(filter);

      res.send({
        success: true,
        data: applications,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching applications:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// PUT - Update application (Tutor only - only when pending)
app.put(
  "/api/applications/:id",
  verifyToken,
  verifyRole(["tutor"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const applicationId = req.params.id;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      if (!ObjectId.isValid(applicationId)) {
        return res.status(400).send({
          success: false,
          error: "Invalid application ID",
        });
      }

      const tutor = await usersCollection.findOne({ email });

      // Find application and check ownership
      const application = await applicationsCollection.findOne({
        _id: new ObjectId(applicationId),
        tutorId: tutor._id,
      });

      if (!application) {
        return res.status(404).send({
          success: false,
          error: "Application not found or you don't have permission",
        });
      }

      // Can only update if status is pending
      if (application.status !== "pending") {
        return res.status(400).send({
          success: false,
          error: "Cannot update application after it has been reviewed",
        });
      }

      const { qualifications, experience, expectedSalary } = req.body;

      const updateData = {
        qualifications,
        experience: Number(experience),
        expectedSalary: Number(expectedSalary),
        updatedAt: new Date(),
      };

      const result = await applicationsCollection.updateOne(
        { _id: new ObjectId(applicationId) },
        { $set: updateData },
      );

      const updatedApplication = await applicationsCollection.findOne({
        _id: new ObjectId(applicationId),
      });

      console.log(`✅ Application updated: ${applicationId} by ${email}`);

      res.send({
        success: true,
        message: "Application updated successfully",
        data: updatedApplication,
      });
    } catch (error) {
      console.error("Error updating application:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// DELETE - Delete application (Tutor only - only when pending)
app.delete(
  "/api/applications/:id",
  verifyToken,
  verifyRole(["tutor"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const applicationId = req.params.id;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      if (!ObjectId.isValid(applicationId)) {
        return res.status(400).send({
          success: false,
          error: "Invalid application ID",
        });
      }

      const tutor = await usersCollection.findOne({ email });

      // Find application and check ownership
      const application = await applicationsCollection.findOne({
        _id: new ObjectId(applicationId),
        tutorId: tutor._id,
      });

      if (!application) {
        return res.status(404).send({
          success: false,
          error: "Application not found or you don't have permission",
        });
      }

      // Can only delete if status is pending
      if (application.status !== "pending") {
        return res.status(400).send({
          success: false,
          error: "Cannot delete application after it has been reviewed",
        });
      }

      await applicationsCollection.deleteOne({
        _id: new ObjectId(applicationId),
      });

      // Decrease applicants count in tuition
      await tuitionsCollection.updateOne(
        { _id: application.tuitionPostId },
        { $inc: { applicants: -1 } },
      );

      console.log(`✅ Application deleted: ${applicationId} by ${email}`);

      res.send({
        success: true,
        message: "Application deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting application:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// GET - Tutor's ongoing tuitions
app.get(
  "/api/tutor/tuitions/ongoing",
  verifyToken,
  verifyRole(["tutor"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
          code: "UNAUTHORIZED_ACCESS",
        });
      }

      const tutor = await usersCollection.findOne({ email });
      if (!tutor) {
        return res.status(404).send({
          success: false,
          error: "Tutor not found",
        });
      }

      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Find all tuitions where this tutor is assigned AND status is ongoing
      const tuitions = await tuitionsCollection
        .find({
          tutorId: tutor._id,
          status: "completed",
        })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await tuitionsCollection.countDocuments({
        tutorId: tutor._id,
        status: "ongoing",
      });

      // Get student details for each tuition
      const tuitionsWithStudent = await Promise.all(
        tuitions.map(async (tuition) => {
          const student = await usersCollection.findOne(
            { _id: tuition.studentId },
            { projection: { name: 1, email: 1, photoURL: 1, phone: 1 } },
          );
          return {
            ...tuition,
            studentDetails: student,
          };
        }),
      );

      res.send({
        success: true,
        data: tuitionsWithStudent,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching ongoing tuitions:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// GET - Revenue history (Tutor only)
app.get(
  "/api/payments/revenue-history",
  verifyToken,
  verifyRole(["tutor"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      const tutor = await usersCollection.findOne({ email });
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Get all payments where this tutor is the receiver
      const payments = await paymentsCollection
        .find({ tutorId: tutor._id, status: "completed" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await paymentsCollection.countDocuments({
        tutorId: tutor._id,
        status: "completed",
      });

      // Get tuition and student details
      const paymentsWithDetails = await Promise.all(
        payments.map(async (payment) => {
          const tuition = await tuitionsCollection.findOne(
            { _id: payment.tuitionId },
            { projection: { title: 1, subject: 1 } },
          );

          const student = await usersCollection.findOne(
            { _id: payment.studentId },
            { projection: { name: 1, photoURL: 1 } },
          );

          return {
            ...payment,
            tuitionDetails: tuition,
            studentDetails: student,
          };
        }),
      );

      // Calculate total earnings
      const totalEarnings = payments.reduce((sum, p) => sum + p.amount, 0);

      res.send({
        success: true,
        data: paymentsWithDetails,
        summary: {
          totalEarnings,
          totalTransactions: total,
          lastPayment: payments[0]?.createdAt || null,
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching revenue history:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// ============= Admin - User Management APIs =============
// =================================================================
// =================================================================

// GET all users (Admin only)
app.get(
  "/api/admin/users",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      const { role, status, page = 1, limit = 10, search } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build filter
      let filter = {};
      if (role && role !== "all") filter.role = role;
      if (status && status !== "all") filter.status = status;
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
        ];
      }

      const users = await usersCollection
        .find(filter)
        .project({ password: 0, firebaseUID: 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await usersCollection.countDocuments(filter);

      res.send({
        success: true,
        data: users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// PATCH - Update user role (Admin only)
app.patch(
  "/api/admin/users/:userId/role",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const { userId } = req.params;
      const { role } = req.body;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      if (!["student", "tutor", "admin"].includes(role)) {
        return res.status(400).send({
          success: false,
          error: "Invalid role",
        });
      }

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({
          success: false,
          error: "Invalid user ID",
        });
      }

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: {
            role,
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

      res.send({
        success: true,
        message: "User role updated successfully",
      });
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// PATCH - Update user status (Admin only)
app.patch(
  "/api/admin/users/:userId/status",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const { userId } = req.params;
      const { status } = req.body;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      if (!["active", "blocked", "pending"].includes(status)) {
        return res.status(400).send({
          success: false,
          error: "Invalid status",
        });
      }

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({
          success: false,
          error: "Invalid user ID",
        });
      }

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: {
            status,
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

      res.send({
        success: true,
        message: "User status updated successfully",
      });
    } catch (error) {
      console.error("Error updating user status:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// DELETE - Delete user (Admin only)
app.delete(
  "/api/admin/users/:userId",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const { userId } = req.params;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      if (!ObjectId.isValid(userId)) {
        return res.status(400).send({
          success: false,
          error: "Invalid user ID",
        });
      }

      // Check if user has any related data
      const applications = await applicationsCollection.countDocuments({
        $or: [
          { studentId: new ObjectId(userId) },
          { tutorId: new ObjectId(userId) },
        ],
      });

      const tuitions = await tuitionsCollection.countDocuments({
        studentId: new ObjectId(userId),
      });

      if (applications > 0 || tuitions > 0) {
        // Soft delete
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              status: "deleted",
              deletedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        );
      } else {
        // Hard delete
        await usersCollection.deleteOne({ _id: new ObjectId(userId) });
      }

      res.send({
        success: true,
        message: "User deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// GET all tuitions for admin (with filters)
app.get(
  "/api/admin/tuitions",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      const { status, page = 1, limit = 10, search } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      let filter = {};
      if (status && status !== "all") filter.status = status;

      if (search) {
        filter.$or = [
          { title: { $regex: search, $options: "i" } },
          { subject: { $regex: search, $options: "i" } },
          { location: { $regex: search, $options: "i" } },
        ];
      }

      const tuitions = await tuitionsCollection
        .find(filter)
        .sort({ posted: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await tuitionsCollection.countDocuments(filter);

      res.send({
        success: true,
        data: tuitions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching tuitions:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// PATCH - Approve tuition
app.patch(
  "/api/admin/tuitions/:tuitionId/approve",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const { tuitionId } = req.params;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      const result = await tuitionsCollection.updateOne(
        { _id: new ObjectId(tuitionId) },
        {
          $set: {
            status: "active",
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          success: false,
          error: "Tuition not found",
        });
      }

      res.send({
        success: true,
        message: "Tuition approved successfully",
      });
    } catch (error) {
      console.error("Error approving tuition:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// PATCH - Reject tuition
app.patch(
  "/api/admin/tuitions/:tuitionId/reject",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const { tuitionId } = req.params;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      const result = await tuitionsCollection.updateOne(
        { _id: new ObjectId(tuitionId) },
        {
          $set: {
            status: "rejected",
            updatedAt: new Date(),
          },
        },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({
          success: false,
          error: "Tuition not found",
        });
      }

      res.send({
        success: true,
        message: "Tuition rejected successfully",
      });
    } catch (error) {
      console.error("Error rejecting tuition:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// GET - Reports data
app.get(
  "/api/admin/reports",
  verifyToken,
  verifyRole(["admin"]),
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;
      const { range = "month", page = 1, limit = 10 } = req.query;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      // Date range calculation
      const now = new Date();
      let startDate = new Date();
      if (range === "week") startDate.setDate(now.getDate() - 7);
      else if (range === "month") startDate.setMonth(now.getMonth() - 1);
      else if (range === "year") startDate.setFullYear(now.getFullYear() - 1);

      // Stats
      const [totalEarnings, totalUsers, totalTuitions, totalApplications] =
        await Promise.all([
          paymentsCollection
            .aggregate([
              { $match: { status: "completed" } },
              { $group: { _id: null, total: { $sum: "$amount" } } },
            ])
            .toArray(),
          usersCollection.countDocuments(),
          tuitionsCollection.countDocuments(),
          applicationsCollection.countDocuments(),
        ]);

      // Role distribution
      const roleDistribution = await usersCollection
        .aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }])
        .toArray();

      // Chart data
      const chartData = await paymentsCollection
        .aggregate([
          {
            $match: {
              status: "completed",
              createdAt: { $gte: startDate },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: range === "year" ? "%Y-%m" : "%Y-%m-%d",
                  date: "$createdAt",
                },
              },
              earnings: { $sum: "$amount" },
            },
          },
          { $sort: { _id: 1 } },
          { $limit: 30 },
        ])
        .toArray();

      // Recent transactions with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const transactions = await paymentsCollection
        .aggregate([
          { $match: { status: "completed" } },
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: parseInt(limit) },
          {
            $lookup: {
              from: "users",
              localField: "studentId",
              foreignField: "_id",
              as: "student",
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "tutorId",
              foreignField: "_id",
              as: "tutor",
            },
          },
          {
            $lookup: {
              from: "tuitions",
              localField: "tuitionId",
              foreignField: "_id",
              as: "tuition",
            },
          },
          {
            $project: {
              _id: 1,
              createdAt: 1,
              amount: 1,
              studentName: { $arrayElemAt: ["$student.name", 0] },
              tutorName: { $arrayElemAt: ["$tutor.name", 0] },
              tuitionTitle: { $arrayElemAt: ["$tuition.title", 0] },
            },
          },
        ])
        .toArray();

      const totalTransactions = await paymentsCollection.countDocuments({
        status: "completed",
      });

      res.send({
        success: true,
        stats: {
          totalEarnings: totalEarnings[0]?.total || 0,
          earningsGrowth: 12, // You can calculate actual growth
          totalUsers,
          activeUsers: await usersCollection.countDocuments({
            status: "active",
          }),
          totalTuitions,
          activeTuitions: await tuitionsCollection.countDocuments({
            status: "active",
          }),
          totalApplications,
          pendingApplications: await applicationsCollection.countDocuments({
            status: "pending",
          }),
        },
        chartData: chartData.map((d) => ({
          name: d._id,
          earnings: d.earnings,
        })),
        roleDistribution: roleDistribution.map((r) => ({
          name: r._id,
          value: r.count,
        })),
        recentTransactions: transactions,
        transactionPagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalTransactions,
          pages: Math.ceil(totalTransactions / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching reports:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// ============= Payment APIs =============

// POST - Create payment intent
app.post(
  "/api/create-payment-intent",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const { applicationId } = req.body;
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      // Get application details
      const application = await applicationsCollection.findOne({
        _id: new ObjectId(applicationId),
      });

      if (!application) {
        return res.status(404).send({
          success: false,
          error: "Application not found",
        });
      }

      // Verify student owns this tuition
      const student = await usersCollection.findOne({ email });
      const tuition = await tuitionsCollection.findOne({
        _id: application.tuitionPostId,
        studentId: student._id,
      });

      if (!tuition) {
        return res.status(403).send({
          success: false,
          error: "You don't have permission",
        });
      }

      // Create payment intent with Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount: application.expectedSalary * 100, // Convert to cents
        currency: "bdt",
        metadata: {
          applicationId: applicationId,
          tuitionId: tuition._id.toString(),
          tutorId: application.tutorId.toString(),
          studentId: student._id.toString(),
        },
      });

      res.send({
        success: true,
        clientSecret: paymentIntent.client_secret,
      });
    } catch (error) {
      console.error("Error creating payment intent:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// POST - Payment success (webhook or manual)
app.post(
  "/api/payment/success",
  verifyToken,
  verifyRole(["student"]),
  async (req, res) => {
    try {
      const { applicationId, paymentIntentId } = req.body;
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      // Get application
      const application = await applicationsCollection.findOne({
        _id: new ObjectId(applicationId),
      });

      if (!application) {
        return res.status(404).send({
          success: false,
          error: "Application not found",
        });
      }

      const student = await usersCollection.findOne({ email });
      const tuition = await tuitionsCollection.findOne({
        _id: application.tuitionPostId,
      });

      // 1. Update application status
      await applicationsCollection.updateOne(
        { _id: new ObjectId(applicationId) },
        { $set: { status: "approved", updatedAt: new Date() } },
      );

      // 2. Update tuition - add tutorId and change status
      await tuitionsCollection.updateOne(
        { _id: application.tuitionPostId },
        {
          $set: {
            tutorId: application.tutorId,
            status: "completed",
            updatedAt: new Date(),
          },
        },
      );

      // 3. Reject other applications for this tuition
      await applicationsCollection.updateMany(
        {
          tuitionPostId: application.tuitionPostId,
          _id: { $ne: new ObjectId(applicationId) },
          status: "pending",
        },
        { $set: { status: "rejected", updatedAt: new Date() } },
      );

      // 4. Save payment record
      const paymentRecord = {
        applicationId: new ObjectId(applicationId),
        tuitionId: application.tuitionPostId,
        studentId: student._id,
        tutorId: application.tutorId,
        amount: application.expectedSalary,
        status: "completed",
        transactionId: paymentIntentId,
        createdAt: new Date(),
      };

      await paymentsCollection.insertOne(paymentRecord);

      res.send({
        success: true,
        message: "Payment successful and tutor approved",
      });
    } catch (error) {
      console.error("Error processing payment success:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// GET - Payment history (Student only - ei API change korte hobe)
app.get(
  "/api/payments/history",
  verifyToken,
  verifyRole(["student"]), // 👈 Add this
  async (req, res) => {
    try {
      const email = req.query.email;
      const decoded_email = req.decoded_user?.email;

      if (email !== decoded_email) {
        return res.status(401).send({
          success: false,
          error: "Forbidden access",
        });
      }

      const user = await usersCollection.findOne({ email });
      const { page = 1, limit = 10 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Student only filter
      const filter = { studentId: user._id };

      const payments = await paymentsCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await paymentsCollection.countDocuments(filter);

      // Get tutor details
      const paymentsWithDetails = await Promise.all(
        payments.map(async (payment) => {
          const tuition = await tuitionsCollection.findOne(
            { _id: payment.tuitionId },
            { projection: { title: 1, subject: 1 } },
          );

          const tutor = await usersCollection.findOne(
            { _id: payment.tutorId },
            { projection: { name: 1, photoURL: 1 } },
          );

          return {
            ...payment,
            tuitionDetails: tuition,
            tutorDetails: tutor,
          };
        }),
      );

      res.send({
        success: true,
        data: paymentsWithDetails,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching payment history:", error);
      res.status(500).send({
        success: false,
        error: error.message,
      });
    }
  },
);

// -----------------Fixing DBs manually-----------------
app.listen(port, async () => {
  console.log(`🚀 Server listening on port ${port}`);

  try {
    await connectToMongoDB();
    console.log("✅ Server setup complete!");
  } catch (error) {
    console.error("❌ Server setup error:", error.message);
  }
});
