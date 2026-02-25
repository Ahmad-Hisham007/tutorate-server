// scripts/createIndexes.js
import { MongoClient } from "mongodb";
import "dotenv/config";

async function runIndexes() {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db("tutorate");

  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ role: 1 });
  await db.collection("tuitions").createIndex({ studentId: 1 });
  await db.collection("tuitions").createIndex({ status: 1 });
  await db.collection("applications").createIndex({ tuitionPostId: 1 });
  await db.collection("applications").createIndex({ tutorId: 1 });
  await db.collection("applications").createIndex({ status: 1 });

  console.log("✅ All indexes created successfully");
  await client.close();
}

runIndexes().catch(console.error);
