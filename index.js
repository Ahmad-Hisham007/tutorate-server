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

// Tuitions API
// GET all tuitions (public route)
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
    console.log(tuition);
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

// Simple function to update existing tuitions with Bangladeshi data
// async function updateTuitions() {
//   try {
//     // Bangladeshi tuition data with all required fields
//     const tuitions = [
//       {
//         _id: "6996bc64e608082ae59e56a0",
//         title: "Mathematics Tutor for HSC Level",
//         institution: "Dhaka College",
//         location: "Dhaka",
//         area: "Dhanmondi, Dhaka",
//         type: "Part-time",
//         mode: "Hybrid",
//         budget: "800-1200/hr",
//         class: "HSC (Class 11-12)",
//         subject: "Calculus & Algebra",
//         posted: "2024-02-18T10:30:00Z",
//         applicants: 12,
//         slots: 2,
//         description:
//           "Dhaka College is seeking an experienced Mathematics tutor for HSC level students. The ideal candidate must have strong knowledge in Calculus and Algebra with prior teaching experience at the college level.",
//         responsibilities: [
//           "Conduct regular classes for HSC level students (Group A & B)",
//           "Cover Calculus, Algebra, and other HSC math topics",
//           "Prepare students for HSC board examinations",
//           "Take weekly tests and provide feedback",
//           "Monitor student progress and report to parents monthly",
//           "Provide additional support for weak students",
//         ],
//         requirements: [
//           "Master's in Mathematics from any reputed university (DU, JU, RU, CU preferred)",
//           "Minimum 2 years of teaching experience at college level",
//           "Excellent communication skills in both Bengali and English",
//           "Experience with HSC curriculum and board questions",
//         ],
//         qualifications: [
//           "B.Ed degree will be优先",
//           "Previous experience with Dhaka College students",
//           "Published research papers in mathematics",
//         ],
//         schedule: {
//           days: "Saturday to Wednesday",
//           hours: "4:00 PM - 7:00 PM",
//           flexible: true,
//           startDate: "2024-03-01",
//           duration: "6 months (with possible extension)",
//         },
//         benefits: [
//           "Competitive hourly rate (800-1200 BDT based on experience)",
//           "Flexible schedule options",
//           "Access to college library and resources",
//           "Opportunity for full-time position",
//           "Transportation allowance included",
//         ],
//         applicationDeadline: "2024-02-28T23:59:59Z",
//         startDate: "2024-03-01T09:00:00Z",
//         experience: "2+ years",
//         education: "Master's Degree Minimum",
//         gender: "Any",
//         status: "active",
//         createdAt: "2024-02-18T10:30:00Z",
//         updatedAt: "2024-02-18T10:30:00Z",
//         studentId: "student_001",
//         views: 245,
//         savedCount: 18,
//       },
//       {
//         _id: "6996bc64e608082ae59e56a1",
//         title: "Physics Teacher for College Level",
//         institution: "Notre Dame College",
//         location: "Dhaka",
//         area: "Motijheel, Dhaka",
//         type: "Full-time",
//         mode: "On-site",
//         budget: "1000-1500/hr",
//         class: "HSC (Class 11-12)",
//         subject: "Physics (1st & 2nd Paper)",
//         posted: "2024-02-20T09:15:00Z",
//         applicants: 8,
//         slots: 1,
//         description:
//           "Notre Dame College, one of the top institutions in Bangladesh, is looking for a dedicated Physics teacher for HSC level. The candidate must be able to teach both Physics 1st and 2nd papers with excellence.",
//         responsibilities: [
//           "Teach Physics 1st and 2nd paper to HSC students",
//           "Prepare lesson plans according to NCTB curriculum",
//           "Conduct practical classes in the laboratory",
//           "Prepare students for board exams and admission tests",
//           "Take extra classes for weak students",
//           "Participate in academic committee meetings",
//         ],
//         requirements: [
//           "Master's in Physics from Dhaka University, JU, or RU",
//           "Minimum 3 years of teaching experience at reputed college",
//           "Strong knowledge of HSC syllabus and board question patterns",
//           "Experience with practical lab sessions",
//         ],
//         qualifications: [
//           "B.Ed or M.Ed degree",
//           "Published research in physics",
//           "Experience with admission test coaching",
//         ],
//         schedule: {
//           days: "Sunday to Thursday",
//           hours: "8:00 AM - 3:00 PM",
//           flexible: false,
//           startDate: "2024-03-15",
//           duration: "Permanent position after 3 months probation",
//         },
//         benefits: [
//           "Higher salary range (1000-1500 BDT per hour)",
//           "Provident fund and gratuity",
//           "Annual bonus (2 festivals)",
//           "Medical allowance",
//           "Transportation facility",
//         ],
//         applicationDeadline: "2024-03-05T23:59:59Z",
//         startDate: "2024-03-15T08:00:00Z",
//         experience: "3+ years",
//         education: "Master's Degree Minimum",
//         gender: "Male/Female",
//         status: "active",
//         createdAt: "2024-02-20T09:15:00Z",
//         updatedAt: "2024-02-20T09:15:00Z",
//         studentId: "student_002",
//         views: 189,
//         savedCount: 12,
//       },
//       {
//         _id: "6996bc64e608082ae59e56a2",
//         title: "English Language Teacher",
//         institution: "Viqarunnisa Noon School & College",
//         location: "Dhaka",
//         area: "Azimpur, Dhaka",
//         type: "Contract",
//         mode: "Online",
//         budget: "600-900/hr",
//         class: "SSC (Class 9-10)",
//         subject: "English 1st & 2nd Paper",
//         posted: "2024-02-19T14:45:00Z",
//         applicants: 15,
//         slots: 3,
//         description:
//           "Viqarunnisa Noon School & College requires English teachers for SSC level students. Candidates must be proficient in both English grammar and literature with experience in the Bangladeshi education system.",
//         responsibilities: [
//           "Teach English 1st and 2nd paper to SSC students",
//           "Focus on grammar, composition, and literature",
//           "Conduct weekly speaking and writing workshops",
//           "Prepare students for SSC board exams",
//           "Provide personalized attention to weak students",
//         ],
//         requirements: [
//           "Master's in English from any public university",
//           "CELTA/TEFL certification preferred",
//           "1+ years of teaching experience",
//           "Excellent proficiency in both Bengali and English",
//         ],
//         qualifications: [
//           "Experience with online teaching platforms",
//           "Content development skills",
//           "IELTS/TOEFL certification",
//         ],
//         schedule: {
//           days: "Friday and Saturday",
//           hours: "9:00 AM - 1:00 PM",
//           flexible: true,
//           startDate: "2024-03-10",
//           duration: "6 months contract",
//         },
//         benefits: [
//           "Flexible weekend schedule",
//           "Work from home",
//           "Paid training sessions",
//           "Performance bonus",
//         ],
//         applicationDeadline: "2024-03-01T23:59:59Z",
//         startDate: "2024-03-10T09:00:00Z",
//         experience: "1+ years",
//         education: "Master's Degree",
//         gender: "Female only (Girls school)",
//         status: "active",
//         createdAt: "2024-02-19T14:45:00Z",
//         updatedAt: "2024-02-19T14:45:00Z",
//         studentId: "student_003",
//         views: 312,
//         savedCount: 28,
//       },
//       {
//         _id: "6996bc64e608082ae59e56a3",
//         title: "Computer Science Instructor",
//         institution: "BUET Lab School",
//         location: "Dhaka",
//         area: "Palashi, Dhaka",
//         type: "Part-time",
//         mode: "Remote",
//         budget: "1000-1400/hr",
//         class: "HSC & Admission Test",
//         subject: "ICT, Programming (C, Python)",
//         posted: "2024-02-17T11:20:00Z",
//         applicants: 9,
//         slots: 2,
//         description:
//           "BUET Lab School is looking for a Computer Science instructor to teach HSC ICT and programming for university admission tests. Ideal for current BUET or DU students with strong programming background.",
//         responsibilities: [
//           "Teach HSC ICT syllabus according to NCTB",
//           "Conduct programming classes (C, C++, Python)",
//           "Prepare students for BUET, DUET, CUET admission tests",
//           "Create coding problems and assignments",
//           "Organize programming contests",
//         ],
//         requirements: [
//           "Current student or graduate from BUET, DU (IMS), or KUET",
//           "Strong programming skills in C and Python",
//           "Minimum CGPA 3.5 in HSC and Bachelor's",
//           "Experience with competitive programming",
//         ],
//         qualifications: [
//           "ICPC or NCPC participation",
//           "Teaching assistant experience",
//           "Project portfolio",
//         ],
//         schedule: {
//           days: "Friday only",
//           hours: "3:00 PM - 8:00 PM",
//           flexible: false,
//           startDate: "2024-03-01",
//           duration: "4 months (Admission test preparation)",
//         },
//         benefits: [
//           "High hourly rate (1000-1400 BDT)",
//           "Only one day commitment",
//           "Access to BUET facilities",
//           "Recommendation letter",
//         ],
//         applicationDeadline: "2024-02-25T23:59:59Z",
//         startDate: "2024-03-01T15:00:00Z",
//         experience: "0-2 years",
//         education: "Bachelor's (ongoing or completed)",
//         gender: "Any",
//         status: "active",
//         createdAt: "2024-02-17T11:20:00Z",
//         updatedAt: "2024-02-17T11:20:00Z",
//         studentId: "student_004",
//         views: 278,
//         savedCount: 21,
//       },
//       {
//         _id: "6996bc64e608082ae59e56a4",
//         title: "Biology Teacher for HSC",
//         institution: "Holy Cross College",
//         location: "Dhaka",
//         area: "Tejgaon, Dhaka",
//         type: "Full-time",
//         mode: "Hybrid",
//         budget: "900-1300/hr",
//         class: "HSC (Class 11-12)",
//         subject: "Biology (Botany & Zoology)",
//         posted: "2024-02-20T08:30:00Z",
//         applicants: 6,
//         slots: 1,
//         description:
//           "Holy Cross College requires an experienced Biology teacher for HSC level. The candidate must be able to teach both Botany and Zoology portions effectively.",
//         responsibilities: [
//           "Teach HSC Biology (Both Botany and Zoology)",
//           "Conduct practical classes and lab sessions",
//           "Prepare students for board exams",
//           "Develop teaching materials and notes",
//           "Evaluate answer scripts and provide feedback",
//         ],
//         requirements: [
//           "Master's in Botany or Zoology from DU, JU, or RU",
//           "Minimum 2 years of teaching experience",
//           "Lab management experience",
//           "Excellent communication skills",
//         ],
//         qualifications: [
//           "Both Botany and Zoology background",
//           "B.Ed degree",
//           "Research experience",
//         ],
//         schedule: {
//           days: "Sunday to Thursday",
//           hours: "9:00 AM - 4:00 PM",
//           flexible: false,
//           startDate: "2024-04-01",
//           duration: "Permanent",
//         },
//         benefits: [
//           "Competitive salary package",
//           "Festival bonuses",
//           "Medical insurance",
//           "Provident fund",
//         ],
//         applicationDeadline: "2024-03-15T23:59:59Z",
//         startDate: "2024-04-01T09:00:00Z",
//         experience: "2+ years",
//         education: "Master's Degree",
//         gender: "Female only",
//         status: "active",
//         createdAt: "2024-02-20T08:30:00Z",
//         updatedAt: "2024-02-20T08:30:00Z",
//         studentId: "student_005",
//         views: 156,
//         savedCount: 9,
//       },
//       {
//         _id: "6996bc64e608082ae59e56a5",
//         title: "Chemistry Tutor for HSC & Admission",
//         institution: "Mastermind School",
//         location: "Dhaka",
//         area: "Banani, Dhaka",
//         type: "Part-time",
//         mode: "Hybrid",
//         budget: "800-1200/hr",
//         class: "HSC & Admission Test",
//         subject: "Chemistry 1st & 2nd Paper",
//         posted: "2024-02-16T16:40:00Z",
//         applicants: 21,
//         slots: 2,
//         description:
//           "Mastermind School is looking for a Chemistry tutor for HSC and medical/engineering admission preparation. The candidate should have strong command over both HSC Chemistry and admission test syllabi.",
//         responsibilities: [
//           "Teach HSC Chemistry 1st and 2nd paper",
//           "Prepare students for medical (MCA) and engineering (ECA) admission tests",
//           "Conduct weekly model tests",
//           "Solve admission test questions from previous years",
//           "Provide tips and tricks for quick problem-solving",
//         ],
//         requirements: [
//           "Master's in Chemistry from DU, JU, or RU",
//           "Minimum 2 years of admission coaching experience",
//           "Knowledge of medical and engineering admission test patterns",
//           "Experience with solving competitive exam questions",
//         ],
//         qualifications: [
//           "B.Sc in Chemistry with high CGPA",
//           "Experience with top coaching centers",
//           "Published question bank or solution book",
//         ],
//         schedule: {
//           days: "Thursday and Friday",
//           hours: "4:00 PM - 9:00 PM",
//           flexible: true,
//           startDate: "2024-03-05",
//           duration: "5 months (Admission season)",
//         },
//         benefits: [
//           "Higher rates for admission coaching",
//           "Small class size (maximum 10 students)",
//           "Performance bonus based on student results",
//           "Free accommodation for outstation candidates",
//         ],
//         applicationDeadline: "2024-02-28T23:59:59Z",
//         startDate: "2024-03-05T16:00:00Z",
//         experience: "2+ years",
//         education: "Master's Degree",
//         gender: "Any",
//         status: "active",
//         createdAt: "2024-02-16T16:40:00Z",
//         updatedAt: "2024-02-16T16:40:00Z",
//         studentId: "student_006",
//         views: 423,
//         savedCount: 35,
//       },
//       {
//         _id: "6996bc64e608082ae59e56a6",
//         title: "Bangla & Social Studies Teacher",
//         institution: "Ideal School & College",
//         location: "Dhaka",
//         area: "Motijheel, Dhaka",
//         type: "Part-time",
//         mode: "On-site",
//         budget: "500-700/hr",
//         class: "Class 6-8",
//         subject: "Bangla, Bangladesh Studies, History",
//         posted: "2024-02-14T10:00:00Z",
//         applicants: 5,
//         slots: 2,
//         description:
//           "Ideal School & College requires a teacher for Bangla and Social Studies for junior sections (Class 6-8). The candidate must be patient and able to engage young students.",
//         responsibilities: [
//           "Teach Bangla literature and grammar to classes 6-8",
//           "Teach Bangladesh Studies, History, and Civics",
//           "Prepare lesson plans and teaching aids",
//           "Conduct regular assessments",
//           "Communicate with parents about student progress",
//         ],
//         requirements: [
//           "Bachelor's in Bangla or Social Science",
//           "1+ year of teaching experience with junior students",
//           "Patient and friendly demeanor",
//           "Good command of both Bangla and English",
//         ],
//         qualifications: [
//           "B.Ed or child psychology courses",
//           "Experience with creative teaching methods",
//           "Storytelling ability",
//         ],
//         schedule: {
//           days: "Saturday to Wednesday",
//           hours: "2:00 PM - 5:00 PM",
//           flexible: true,
//           startDate: "2024-03-01",
//           duration: "Academic year 2024",
//         },
//         benefits: [
//           "Fixed schedule with afternoon hours",
//           "Transportation allowance",
//           "Opportunity for full-time position",
//         ],
//         applicationDeadline: "2024-02-25T23:59:59Z",
//         startDate: "2024-03-01T14:00:00Z",
//         experience: "1+ years",
//         education: "Bachelor's Degree",
//         gender: "Female preferred",
//         status: "active",
//         createdAt: "2024-02-14T10:00:00Z",
//         updatedAt: "2024-02-14T10:00:00Z",
//         studentId: "student_007",
//         views: 98,
//         savedCount: 7,
//       },
//       {
//         _id: "6996bc64e608082ae59e56a7",
//         title: "Art & Crafts Teacher",
//         institution: "Chittagong Grammar School",
//         location: "Chittagong",
//         area: "Nasirabad, Chittagong",
//         type: "Freelance",
//         mode: "Hybrid",
//         budget: "400-600/hr",
//         class: "Class 3-10",
//         subject: "Drawing, Painting, Crafts",
//         posted: "2024-02-18T13:20:00Z",
//         applicants: 18,
//         slots: 2,
//         description:
//           "Chittagong Grammar School is seeking a creative Art teacher for students from primary to secondary levels. The candidate should be proficient in various art forms and crafts.",
//         responsibilities: [
//           "Teach drawing, painting, and various craft techniques",
//           "Organize art competitions and exhibitions",
//           "Prepare students for art Olympiads",
//           "Develop creative curriculum",
//           "Maintain art supplies inventory",
//         ],
//         requirements: [
//           "Bachelor's in Fine Arts (BFA) from DU or CU",
//           "Portfolio of personal artwork",
//           "Experience teaching children",
//           "Knowledge of both traditional and digital art",
//         ],
//         qualifications: [
//           "Experience with school exhibitions",
//           "Workshop facilitation skills",
//           "Knowledge of Bangladeshi folk art",
//         ],
//         schedule: {
//           days: "Thursday and Friday",
//           hours: "3:00 PM - 6:00 PM",
//           flexible: true,
//           startDate: "2024-03-15",
//           duration: "6 months renewable",
//         },
//         benefits: [
//           "Creative work environment",
//           "Flexible hours",
//           "Art supply allowance",
//           "Opportunity to sell student art",
//         ],
//         applicationDeadline: "2024-03-10T23:59:59Z",
//         startDate: "2024-03-15T15:00:00Z",
//         experience: "0-2 years",
//         education: "Bachelor of Fine Arts",
//         gender: "Any",
//         status: "active",
//         createdAt: "2024-02-18T13:20:00Z",
//         updatedAt: "2024-02-18T13:20:00Z",
//         studentId: "student_008",
//         views: 267,
//         savedCount: 31,
//       },
//     ];

//     let updatedCount = 0;
//     let notFoundCount = 0;

//     for (const tuition of tuitions) {
//       // Store the ID separately
//       const tuitionId = tuition._id;

//       // Create a copy without the _id field for updating
//       const { _id, ...updateData } = tuition;

//       // Convert string dates to Date objects in the updateData
//       if (updateData.posted) updateData.posted = new Date(updateData.posted);
//       if (updateData.applicationDeadline)
//         updateData.applicationDeadline = new Date(
//           updateData.applicationDeadline,
//         );
//       if (updateData.startDate)
//         updateData.startDate = new Date(updateData.startDate);
//       if (updateData.createdAt)
//         updateData.createdAt = new Date(updateData.createdAt);
//       if (updateData.updatedAt) updateData.updatedAt = new Date();

//       // Handle schedule dates
//       if (updateData.schedule && updateData.schedule.startDate) {
//         updateData.schedule.startDate = new Date(updateData.schedule.startDate);
//       }

//       // Update by _id (using the stored ID for the query)
//       const result = await tuitionsCollection.updateOne(
//         { _id: new ObjectId(tuitionId) },
//         { $set: updateData },
//       );

//       if (result.modifiedCount > 0) {
//         updatedCount++;
//         console.log(`✅ Updated: ${tuition.title}`);
//       } else if (result.matchedCount === 0) {
//         notFoundCount++;
//         console.log(`❌ Not found: ${tuition.title} (ID: ${tuitionId})`);
//       }
//     }

//     console.log(`\n📊 Update Summary:`);
//     console.log(
//       `✅ ${updatedCount} tuitions updated successfully with Bangladeshi data`,
//     );
//     if (notFoundCount > 0) {
//       console.log(`⚠️ ${notFoundCount} tuitions not found (IDs don't exist)`);
//     }
//   } catch (error) {
//     console.log("❌ Update error:", error.message);
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

    // await updateTuitions();

    console.log("✅ Server setup complete!");
  } catch (error) {
    console.error("❌ Server setup error:", error.message);
  }
});
