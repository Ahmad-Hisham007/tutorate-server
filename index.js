// Contexts/AuthProvider/AuthProvider.jsx
import React, { useEffect, useState } from "react";
import { createContext } from "react";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import app from "../../Firebase/Firebase.init";
import toast from "react-hot-toast";
import useAxios from "../../hooks/useAxios";

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext();
// eslint-disable-next-line react-refresh/only-export-components
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const axios = useAxios();

  useEffect(() => {
    const unSubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unSubscribe();
  }, []);

  // Register function
  const handleRegister = async (data) => {
    const { email, password, name, phone, role, photoURL } = data;

    try {
      setLoading(true);

      // 1. Create user in Firebase
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      const firebaseUser = userCredential.user;

      // 2. Update Firebase profile
      await updateProfile(firebaseUser, {
        displayName: name,
        photoURL:
          photoURL ||
          `https://ui-avatars.com/api/?name=${name}&background=random`,
      });

      // 3. Save user to MongoDB
      const userData = {
        uid: firebaseUser.uid,
        name,
        email,
        phone,
        photoURL:
          photoURL ||
          `https://ui-avatars.com/api/?name=${name}&background=random`,
        role,
      };

      const response = await axios.post("/users", userData);
      console.log("MongoDB response:", response.data); // { acknowledged: true, insertedId: ... }

      toast.success("Registration successful! Please login.");
      return { success: true };
    } catch (error) {
      console.error("Registration failed:", error);

      if (error.response?.status === 400) {
        toast.error(error.response.data.error || "Registration failed");
      } else {
        toast.error("Registration failed. Please try again.");
      }

      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // Login function
  const handleLogin = async (data) => {
    const { email, password } = data;

    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
      toast.success("Login Successful");
      return { success: true };
    } catch (err) {
      toast.error("Login Failed: " + err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  // Google Login
  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      const result = await signInWithPopup(auth, googleProvider);
      const firebaseUser = result.user;

      // This will either create new user or update existing one
      const response = await axios.post("/users/google", {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
      });

      console.log("Google login MongoDB response:", response.data); // MongoDB operation result

      toast.success("Google Login Successful");
      return { success: true };
    } catch (error) {
      console.error("Google login failed:", error);
      toast.error("Google login failed");
      return { success: false, error: error.message };
    } finally {
      setLoading(false);
    }
  };

  // Log out function
  const logOut = async () => {
    setUser(null);
    return signOut(auth);
  };

  const authData = {
    user,
    handleRegister,
    handleLogin,
    handleGoogleLogin,
    logOut,
    loading,
    setLoading,
  };

  return (
    <AuthContext.Provider value={authData}>{children}</AuthContext.Provider>
  );
};

export default AuthProvider;
