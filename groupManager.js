// groupManager.js
// Group creation, joining, and management functions

import { auth, db } from "./src/firebaseAPIConfig.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  query,
  where,
  onSnapshot,
  arrayUnion,
  serverTimestamp,
} from "firebase/firestore";

/**
 * Show notification message
 */
function showNotification(message, type = "success") {
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.classList.add("show"), 10);
  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/**
 * Generate a unique shareable group code
 */
function generateGroupCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new group
 */
export async function createGroup(groupName) {
  if (!auth.currentUser) {
    showNotification("Please login first", "error");
    return null;
  }

  try {
    const groupCode = generateGroupCode();

    const groupData = {
      name: groupName,
      code: groupCode,
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
      members: [auth.currentUser.uid],
      memberDetails: {
        [auth.currentUser.uid]: {
          email: auth.currentUser.email,
          joinedAt: serverTimestamp(),
          role: "owner",
        },
      },
    };

    const groupRef = await addDoc(collection(db, "groups"), groupData);

    // Add group reference to user's document
    const userRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(userRef, {
      groups: arrayUnion(groupRef.id),
    });

    showNotification("Group created successfully!", "success");
    return { id: groupRef.id, code: groupCode };
  } catch (error) {
    console.error("Error creating group:", error);
    showNotification("Failed to create group", "error");
    return null;
  }
}

/**
 * Join a group using invite code
 */
export async function joinGroup(groupCode) {
  if (!auth.currentUser) {
    showNotification("Please login first", "error");
    return false;
  }

  try {
    // Find group by code
    const groupsRef = collection(db, "groups");
    const q = query(groupsRef, where("code", "==", groupCode.toUpperCase()));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      showNotification("Invalid group code", "error");
      return false;
    }

    const groupDoc = snapshot.docs[0];
    const groupData = groupDoc.data();

    // Check if already a member
    if (groupData.members.includes(auth.currentUser.uid)) {
      showNotification("You are already in this group", "info");
      return false;
    }

    // Add user to group
    await updateDoc(doc(db, "groups", groupDoc.id), {
      members: arrayUnion(auth.currentUser.uid),
      [`memberDetails.${auth.currentUser.uid}`]: {
        email: auth.currentUser.email,
        joinedAt: serverTimestamp(),
        role: "member",
      },
    });

    // Add group to user's document
    const userRef = doc(db, "users", auth.currentUser.uid);
    await updateDoc(userRef, {
      groups: arrayUnion(groupDoc.id),
    });

    showNotification("Successfully joined the group!", "success");
    return true;
  } catch (error) {
    console.error("Error joining group:", error);
    showNotification("Failed to join group", "error");
    return false;
  }
}

/**
 * Listen to user's groups in real-time
 */
export function listenUserGroups(userId, callback) {
  const groupsRef = collection(db, "groups");
  const q = query(groupsRef, where("members", "array-contains", userId));

  return onSnapshot(q, (snapshot) => {
    const groups = [];
    snapshot.forEach((doc) => {
      groups.push({
        id: doc.id,
        ...doc.data(),
      });
    });
    callback(groups);
  });
}

/**
 * Get group invite link
 */
export function getGroupInviteLink(groupCode) {
  const baseUrl = window.location.origin;
  return `${baseUrl}/MainPage.html?join=${groupCode}`;
}

// Fix missing import
import { getDocs } from "firebase/firestore";
