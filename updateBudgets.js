// একটা আলাদা ফাইল বানাও: scripts/updateBudgets.js
async function updateBudgets() {
  try {
    const tuitions = await tuitionsCollection.find({}).toArray();

    for (const tuition of tuitions) {
      const budgetStr = tuition.budget; // "800-1200/hr"

      // স্ট্রিং থেকে নাম্বার বের করো
      const matches = budgetStr.match(/(\d+)-(\d+)/);
      if (matches) {
        const minBudget = parseInt(matches[1]);
        const maxBudget = parseInt(matches[2]);

        // আপডেট করো
        await tuitionsCollection.updateOne(
          { _id: tuition._id },
          {
            $set: {
              minBudget: minBudget,
              maxBudget: maxBudget,
              budgetType: "BDT",
            },
          },
        );

        console.log(
          `✅ Updated: ${tuition.title} -> ${minBudget}-${maxBudget}`,
        );
      }
    }

    console.log("🎉 সব টিউশন আপডেট করা শেষ!");
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

export default updateBudgets();
// এই স্ক্রিপ্ট একবার চালাবে
