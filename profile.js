// Profile.js
// User profile management with Firebase storage

import { auth, db, storage } from "./src/firebaseAPIConfig.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// Storage artık import ediliyor, yeniden başlatmaya gerek yok

let currentUser = null;
let profileImageUrl = null;

// ============================================
// Load User Profile
// ============================================

/**
 * Load user profile data from Firestore
 */
async function loadUserProfile(user) {
  try {
    // Get user document from Firestore
    const userDocRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userDocRef);

    // Display user email
    document.getElementById("userEmail").textContent = user.email;

    if (userDoc.exists()) {
      const userData = userDoc.data();

      // Display user name
      document.getElementById("userName").textContent =
        userData.name || "Not set";

      // Display member since date
      if (userData.createdAt) {
        const createdDate = userData.createdAt.toDate();
        document.getElementById("memberSince").textContent =
          createdDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
      }

      // Display profile picture
      if (userData.photoURL) {
        profileImageUrl = userData.photoURL;
        document.getElementById("profileImage").src = userData.photoURL;
      } else {
        // Default avatar
        document.getElementById(
          "profileImage"
        ).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
          user.email
        )}&size=150&background=667eea&color=fff`;
      }
    } else {
      // Create user document if doesn't exist
      await setDoc(userDocRef, {
        name: user.displayName || "User",
        email: user.email,
        createdAt: new Date(),
        photoURL: null,
      });

      document.getElementById("userName").textContent =
        user.displayName || "User";
      document.getElementById("memberSince").textContent =
        new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

      // Default avatar
      document.getElementById(
        "profileImage"
      ).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
        user.email
      )}&size=150&background=667eea&color=fff`;
    }
  } catch (error) {
    console.error("Error loading profile:", error);
    alert("Failed to load profile: " + error.message);
  }
}

// ============================================
// Upload Profile Picture
// ============================================

/**
 * Handle profile picture upload
 */
async function uploadProfilePicture(file) {
  if (!currentUser) {
    alert("No user logged in");
    return;
  }

  try {
    console.log("Starting upload for user:", currentUser.uid);

    // Create a storage reference with proper path
    const storageRef = ref(storage, `profile_pictures/${currentUser.uid}`);

    console.log("Uploading file...");
    // Upload the file
    const snapshot = await uploadBytes(storageRef, file);
    console.log("Upload successful:", snapshot);

    // Get the download URL
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log("Download URL:", downloadURL);

    // Update profile image
    document.getElementById("profileImage").src = downloadURL;
    profileImageUrl = downloadURL;

    // Update Firestore
    const userDocRef = doc(db, "users", currentUser.uid);
    await updateDoc(userDocRef, {
      photoURL: downloadURL,
    });

    alert("Profile picture updated successfully!");
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    console.error("Error code:", error.code);
    console.error("Error message:", error.message);
    alert("Failed to upload profile picture: " + error.message);
  }
}

// ============================================
// Logout Function
// ============================================

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = "/Login.html";
  } catch (error) {
    console.error("Error logging out:", error);
    alert("Failed to logout");
  }
}

// ============================================
// Event Listeners
// ============================================

document.addEventListener("DOMContentLoaded", function () {
  // Check authentication
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      loadUserProfile(user);
    } else {
      window.location.href = "/Login.html";
    }
  });

  // Upload button click
  document.getElementById("uploadBtn").addEventListener("click", () => {
    document.getElementById("imageInput").click();
  });

  // Profile picture click
  document.getElementById("profileImage").addEventListener("click", () => {
    document.getElementById("imageInput").click();
  });

  // File input change
  document.getElementById("imageInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith("image/")) {
        alert("Please select an image file");
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert("Image size must be less than 5MB");
        return;
      }

      // Preview image immediately
      const reader = new FileReader();
      reader.onload = (e) => {
        document.getElementById("profileImage").src = e.target.result;
      };
      reader.readAsDataURL(file);

      // Upload to Firebase
      uploadProfilePicture(file);
    }
  });

  // Save button (currently just shows confirmation)
  document.getElementById("saveBtn").addEventListener("click", () => {
    alert("Profile saved successfully!");
  });

  // Logout button
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
});
