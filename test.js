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
