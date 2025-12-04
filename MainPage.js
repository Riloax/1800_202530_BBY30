// MainPage.js
// Calendar application with Firebase authentication, task management, and category filtering

import { auth, db } from "./src/firebaseAPIConfig.js";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  setDoc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";

// ============================================
// State Variables
// ============================================

let currentUser = null;
let tasks = [];
let currentWeekOffset = 0;
let weekDates = [];
let userGroups = [];
let groupsUnsubscribe = null;

// Category filter state (all enabled by default)
let categoryFilters = {
  study: true,
  work: true,
  exercise: true,
  group: true,
};

// Drag system variables
let isDragging = false;
let draggedTask = null;
let draggedElement = null;
let dragClone = null;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
let autoScrollInterval = null;

// Firestore real-time listener
let unsubscribe = null;

// ============================================
// Date Helper Functions
// ============================================

/**
 * Get the Monday of the week for a given date
 * @param {Date} d - The date to find Monday for
 * @returns {Date} - Monday of that week
 */
function getMonday(d) {
  d = new Date(d);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

/**
 * Format date as YYYY-MM-DD
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
  return date.toISOString().split("T")[0];
}

// ============================================
// Calendar Functions
// ============================================

/**
 * Update the week display header with dates
 */
function updateWeekDisplay() {
  const today = new Date();
  const monday = getMonday(today);
  monday.setDate(monday.getDate() + currentWeekOffset * 7);

  weekDates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(date.getDate() + i);
    weekDates.push(formatDate(date));
  }

  // Update day headers with dates
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  weekDates.forEach((date, i) => {
    const dayEl = document.getElementById(`day${i}`);

    const [year, month, day] = date.split("-").map(Number);
    // Fix timezone issue by using UTC
    const dateObj = new Date(Date.UTC(year, month - 1, day));

    dayEl.innerHTML = `${
      dayNames[i]
    }<br><span style="font-size: 12px; font-weight: normal;">${dateObj.getUTCDate()}/${
      dateObj.getUTCMonth() + 1
    }</span>`;
  });

  // Update week range display
  const [year1, month1, day1] = weekDates[0].split("-").map(Number);
  const [year2, month2, day2] = weekDates[6].split("-").map(Number);
  const firstDate = new Date(Date.UTC(year1, month1 - 1, day1));
  const lastDate = new Date(Date.UTC(year2, month2 - 1, day2));

  document.getElementById(
    "weekDisplay"
  ).textContent = `${firstDate.getUTCDate()} ${firstDate.toLocaleString("en", {
    month: "short",
    timeZone: "UTC",
  })} - ${lastDate.getUTCDate()} ${lastDate.toLocaleString("en", {
    month: "short",
    timeZone: "UTC",
  })} ${lastDate.getUTCFullYear()}`;
}

/**
 * Change the displayed week
 * @param {number} offset - Number of weeks to move (-1 for previous, +1 for next)
 */
function changeWeek(offset) {
  currentWeekOffset += offset;
  updateWeekDisplay();
  renderTasks();
}

/**
 * Initialize the calendar grid (24 hours x 7 days, starting from 6 AM)
 */
function initCalendar() {
  const calendarBody = document.getElementById("calendarBody");

  // Create hours array: 6-23, then 0-5
  const hours = [...Array(18).keys()]
    .map((i) => i + 6)
    .concat([...Array(6).keys()]);

  hours.forEach((hour) => {
    const row = document.createElement("div");
    row.className = "calendar-row";

    // Time label column
    const timeCell = document.createElement("div");
    timeCell.className = "time-cell";
    timeCell.textContent = `${hour.toString().padStart(2, "0")}:00`;
    row.appendChild(timeCell);

    // Create 7 day cells
    for (let day = 0; day < 7; day++) {
      const dayCell = document.createElement("div");
      dayCell.className = "day-cell";
      dayCell.dataset.dayIndex = day;
      dayCell.dataset.hour = hour;
      row.appendChild(dayCell);
    }

    calendarBody.appendChild(row);
  });

  updateWeekDisplay();

  // Scroll to 6 AM (top of the schedule)
  const scheduleBox = document.querySelector(".schedule-box");
  if (scheduleBox) {
    scheduleBox.scrollTop = 0;
  }
}

// ============================================
// Category Filter Functions
// ============================================

/**
 * Check if a task should be visible based on category filters
 * @param {string} category - Task category
 * @returns {boolean} - Whether task should be visible
 */
function shouldShowTask(category) {
  return categoryFilters[category] === true;
}

/**
 * Update category filter state and re-render tasks
 * @param {string} category - Category to toggle
 * @param {boolean} isChecked - New checked state
 */
function updateCategoryFilter(category, isChecked) {
  categoryFilters[category] = isChecked;
  renderTasks();
}

// ============================================
// Notification Functions
// ============================================

/**
 * Show a notification message to the user
 * @param {string} message - Message to display
 * @param {string} type - Type of notification ('success', 'error', 'info')
 */
function showNotification(message, type = "success") {
  // Create notification element
  const notification = document.createElement("div");
  notification.className = `notification notification-${type}`;
  notification.textContent = message;

  // Add to body
  document.body.appendChild(notification);

  // Trigger animation
  setTimeout(() => {
    notification.classList.add("show");
  }, 10);

  // Remove after 3 seconds
  setTimeout(() => {
    notification.classList.remove("show");
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

// ============================================
// Drag and Drop System
// ============================================

/**
 * Handle mouse/touch down event - start of drag
 */
function handleMouseDown(e, task, taskElement) {
  // Don't drag if clicking delete button
  if (e.target.classList.contains("task-delete")) {
    return;
  }

  isDragging = false;
  draggedTask = task;
  draggedElement = taskElement;

  // Get position from mouse or touch
  const clientX = e.type === "touchstart" ? e.touches[0].clientX : e.clientX;
  const clientY = e.type === "touchstart" ? e.touches[0].clientY : e.clientY;

  startX = clientX;
  startY = clientY;
  currentX = clientX;
  currentY = clientY;

  // Add appropriate event listeners
  if (e.type === "touchstart") {
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
  } else {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  // Prevent scrolling while dragging
  const scheduleBox = document.querySelector(".schedule-box");
  if (scheduleBox) {
    scheduleBox.style.overflow = "hidden";
  }

  e.preventDefault();
  e.stopPropagation();
}

/**
 * Handle mouse move during drag
 */
function handleMouseMove(e) {
  if (!draggedTask) return;

  currentX = e.clientX;
  currentY = e.clientY;
  handleDragMove(currentX, currentY);
  e.preventDefault();
}

/**
 * Handle touch move during drag
 */
function handleTouchMove(e) {
  if (!draggedTask) return;

  currentX = e.touches[0].clientX;
  currentY = e.touches[0].clientY;
  handleDragMove(currentX, currentY);
  e.preventDefault();
}

/**
 * Common drag move logic for both mouse and touch
 */
function handleDragMove(x, y) {
  const deltaX = Math.abs(x - startX);
  const deltaY = Math.abs(y - startY);

  // Start dragging after 3px movement threshold
  if (!isDragging && (deltaX > 3 || deltaY > 3)) {
    isDragging = true;

    // Create visual clone of task
    dragClone = draggedElement.cloneNode(true);
    dragClone.style.position = "fixed";
    dragClone.style.pointerEvents = "none";
    dragClone.style.opacity = "0.8";
    dragClone.style.zIndex = "10000";
    dragClone.style.width = draggedElement.offsetWidth + "px";
    dragClone.style.height = draggedElement.offsetHeight + "px";
    dragClone.style.cursor = "grabbing";
    dragClone.style.transform = "scale(1.05)";
    document.body.appendChild(dragClone);

    // Fade out original element
    draggedElement.style.opacity = "0.3";
  }

  if (isDragging && dragClone) {
    // Move clone to follow cursor
    dragClone.style.left = x - draggedElement.offsetWidth / 2 + "px";
    dragClone.style.top = y - 20 + "px";

    // Auto-scroll functionality
    const scheduleBox = document.querySelector(".schedule-box");
    if (scheduleBox) {
      const rect = scheduleBox.getBoundingClientRect();
      const scrollThreshold = 50; // pixels from edge to trigger scroll
      const scrollSpeed = 10; // pixels per interval

      // Clear existing interval
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
      }

      // Check if near top edge
      if (y - rect.top < scrollThreshold && y > rect.top) {
        autoScrollInterval = setInterval(() => {
          scheduleBox.scrollTop -= scrollSpeed;
        }, 20);
      }
      // Check if near bottom edge
      else if (rect.bottom - y < scrollThreshold && y < rect.bottom) {
        autoScrollInterval = setInterval(() => {
          scheduleBox.scrollTop += scrollSpeed;
        }, 20);
      }

      // Check if near left edge
      else if (x - rect.left < scrollThreshold && x > rect.left) {
        autoScrollInterval = setInterval(() => {
          scheduleBox.scrollLeft -= scrollSpeed;
        }, 20);
      }
      // Check if near right edge
      else if (rect.right - x < scrollThreshold && x < rect.right) {
        autoScrollInterval = setInterval(() => {
          scheduleBox.scrollLeft += scrollSpeed;
        }, 20);
      }
    }

    // Find cell under cursor
    const elements = document.elementsFromPoint(x, y);

    // Remove all highlights
    document.querySelectorAll(".day-cell").forEach((cell) => {
      cell.classList.remove("drag-over");
    });

    // Highlight cell under cursor
    const dayCell = elements.find((el) => el.classList.contains("day-cell"));
    if (dayCell) {
      dayCell.classList.add("drag-over");
    }
  }
}

/**
 * Handle mouse up - end of drag
 */
async function handleMouseUp(e) {
  document.removeEventListener("mousemove", handleMouseMove);
  document.removeEventListener("mouseup", handleMouseUp);
  await finishDrag();
}

/**
 * Handle touch end - end of drag
 */
async function handleTouchEnd(e) {
  document.removeEventListener("touchmove", handleTouchMove);
  document.removeEventListener("touchend", handleTouchEnd);
  await finishDrag();
}

/**
 * Finish drag operation and update Firestore
 */
async function finishDrag() {
  // Re-enable scrolling
  const scheduleBox = document.querySelector(".schedule-box");
  if (scheduleBox) {
    scheduleBox.style.overflow = "auto";
  }

  if (isDragging && draggedTask && currentUser) {
    // Find which cell task was dropped on
    const elements = document.elementsFromPoint(currentX, currentY);
    const dayCell = elements.find((el) => el.classList.contains("day-cell"));

    if (dayCell) {
      const dayIndex = parseInt(dayCell.dataset.dayIndex);
      const hour = parseInt(dayCell.dataset.hour);

      const newDate = weekDates[dayIndex];

      // Use the exact hour from the cell (no minute offset calculation)
      const oldStartTime = draggedTask.startTime || draggedTask.time;
      const oldStartMinute = parseInt(oldStartTime.split(":")[1]) || 0;

      // Keep the same minutes as the original task
      const newStartTime = `${hour.toString().padStart(2, "0")}:${oldStartMinute
        .toString()
        .padStart(2, "0")}`;

      // Calculate end time based on duration
      const oldEndTime = draggedTask.time;

      // Validate that old times exist
      if (!oldStartTime || !oldEndTime) {
        console.error("Task missing time information for drag operation");
        cleanupDrag();
        return;
      }

      // Calculate duration in minutes
      const oldStartParts = oldStartTime.split(":");
      const oldEndParts = oldEndTime.split(":");
      const oldStartMinutes =
        parseInt(oldStartParts[0]) * 60 + parseInt(oldStartParts[1]);
      const oldEndMinutes =
        parseInt(oldEndParts[0]) * 60 + parseInt(oldEndParts[1]);
      let durationMinutes = oldEndMinutes - oldStartMinutes;

      // Handle next day scenario
      if (durationMinutes < 0) {
        durationMinutes += 24 * 60;
      }

      // Calculate new end time
      const newStartMinutes = hour * 60 + oldStartMinute;
      const newEndMinutes = newStartMinutes + durationMinutes;
      const newEndHour = Math.floor(newEndMinutes / 60) % 24;
      const newEndMinute = newEndMinutes % 60;
      const newEndTime = `${newEndHour
        .toString()
        .padStart(2, "0")}:${newEndMinute.toString().padStart(2, "0")}`;

      // Update in Firestore if date/time changed
      if (
        draggedTask.date !== newDate ||
        draggedTask.startTime !== newStartTime
      ) {
        try {
          const taskRef = doc(db, "tasks", draggedTask.firestoreId);
          await updateDoc(taskRef, {
            date: newDate,
            startTime: newStartTime,
            time: newEndTime,
          });
        } catch (error) {
          console.error("Error updating task:", error);
          showNotification("Failed to update task", "error");
        }
      }
    }
  }

  cleanupDrag();
}

/**
 * Cleanup drag elements and state
 */
function cleanupDrag() {
  // Clear auto-scroll interval
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }

  // Cleanup
  if (dragClone) {
    dragClone.remove();
    dragClone = null;
  }

  if (draggedElement) {
    draggedElement.style.opacity = "1";
  }

  document.querySelectorAll(".day-cell").forEach((cell) => {
    cell.classList.remove("drag-over");
  });

  isDragging = false;
  draggedTask = null;
  draggedElement = null;
}

// ============================================
// Modal Functions
// ============================================

function openModal() {
  document.getElementById("taskModal").style.display = "block";
}

function closeModal() {
  document.getElementById("taskModal").style.display = "none";
  document.getElementById("taskForm").reset();
}

// ============================================
// Task Management Functions
// ============================================

/**
 * Calculate the height of task based on duration (in minutes precision)
 * @param {string} startTime - Start time in HH:mm format
 * @param {string} endTime - End time in HH:mm format
 * @returns {number} - Duration in hours (decimal)
 */
function calculateDuration(startTime, endTime) {
  // Validate inputs
  if (
    !startTime ||
    !endTime ||
    typeof startTime !== "string" ||
    typeof endTime !== "string"
  ) {
    console.warn(
      "Invalid time format in calculateDuration:",
      startTime,
      endTime
    );
    return 1; // Default to 1 hour
  }

  const startParts = startTime.split(":");
  const endParts = endTime.split(":");

  if (startParts.length < 2 || endParts.length < 2) {
    console.warn(
      "Invalid time format in calculateDuration:",
      startTime,
      endTime
    );
    return 1; // Default to 1 hour
  }

  const startHour = parseInt(startParts[0]);
  const startMinute = parseInt(startParts[1]) || 0;
  const endHour = parseInt(endParts[0]);
  const endMinute = parseInt(endParts[1]) || 0;

  // Convert to total minutes
  const startTotalMinutes = startHour * 60 + startMinute;
  let endTotalMinutes = endHour * 60 + endMinute;

  // Handle next day scenario (e.g., 23:00 to 02:00)
  if (endTotalMinutes < startTotalMinutes) {
    endTotalMinutes += 24 * 60; // Add 24 hours
  }

  const durationMinutes = endTotalMinutes - startTotalMinutes;
  const durationHours = durationMinutes / 60;

  // Ensure minimum duration of 5 minutes (0.083 hours)
  return durationHours > 0.083 ? durationHours : 0.083;
}

/**
 * Render all tasks on the calendar
 */
/**
 * Render all tasks on the calendar
 * FIXED: Uses Percentage (%) instead of Pixels for responsiveness
 */
function renderTasks() {
  // Remove all existing task elements & overlays
  document.querySelectorAll(".task-item").forEach((item) => item.remove());
  document.querySelectorAll(".task-overlay").forEach((item) => item.remove());

  tasks.forEach((task) => {
    // Skip if invalid
    if (!task.date || !task.time) return;

    const dayIndex = weekDates.indexOf(task.date);

    if (dayIndex !== -1) {
      // Data preparation
      const startTime = task.startTime || task.time;
      const endTime = task.time;

      const startHour = parseInt(startTime.split(":")[0]);
      const startMinute = parseInt(startTime.split(":")[1]) || 0;

      let endHour = parseInt(endTime.split(":")[0]);
      let endMinute = parseInt(endTime.split(":")[1]) || 0;

      if (task.startTime && task.startTime === task.time) {
        endHour = startHour + 1;
      }

      const startCell = document.querySelector(
        `.day-cell[data-day-index="${dayIndex}"][data-hour="${startHour}"]`
      );

      if (startCell) {
        // 1. Calculate Duration in Minutes
        const startTotalMinutes = startHour * 60 + startMinute;
        let endTotalMinutes = endHour * 60 + endMinute;

        if (endTotalMinutes <= startTotalMinutes) endTotalMinutes += 24 * 60;

        const durationMinutes = endTotalMinutes - startTotalMinutes;

        const heightPercentage = (durationMinutes / 60) * 100;

        const topPercentage = (startMinute / 60) * 100;

        // -------------------------

        // Create Task Element
        const taskItem = document.createElement("div");
        taskItem.className = "task-item";
        taskItem.dataset.category = task.category || "study";

        if (!shouldShowTask(task.category || "study")) {
          taskItem.classList.add("hidden");
        }

        taskItem.style.position = "absolute";

        taskItem.style.top = `${topPercentage}%`;

        taskItem.style.left = "0";
        taskItem.style.width = "100%";

        taskItem.style.height = `${heightPercentage}%`;

        taskItem.style.zIndex = "10";
        taskItem.style.boxSizing = "border-box";

        const timeDisplay = `${startTime} - ${endTime}`;

        taskItem.innerHTML = `
          <div class="task-name">${task.name}</div>
          <div class="task-time">${timeDisplay}</div>
          <button class="task-delete">×</button>
        `;

        taskItem.addEventListener("mousedown", (e) =>
          handleMouseDown(e, task, taskItem)
        );
        taskItem.addEventListener(
          "touchstart",
          (e) => handleMouseDown(e, task, taskItem),
          { passive: false }
        );

        taskItem
          .querySelector(".task-delete")
          .addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`Delete task "${task.name}"?`))
              deleteTask(task.firestoreId);
          });

        startCell.appendChild(taskItem);
      }
    }
  });
}

/**
 * Delete a task from Firestore
 * @param {string} firestoreId - Document ID in Firestore
 */
async function deleteTask(firestoreId) {
  if (!currentUser) return;

  try {
    // 1️⃣ Delete the task document
    await deleteDoc(doc(db, "tasks", firestoreId));

    // 2️⃣ Find any reminders that reference this task
    const remindersRef = collection(db, "users", currentUser.uid, "reminders");
    const q = query(remindersRef, where("eventLink", "==", firestoreId));
    const snapshot = await getDocs(q);

    // 3️⃣ Clear the eventLink for each reminder
    for (const docSnap of snapshot.docs) {
      await updateDoc(
        doc(db, "users", currentUser.uid, "reminders", docSnap.id),
        {
          eventLink: null,
        }
      );
    }

    showNotification("Task deleted successfully", "success");
  } catch (error) {
    console.error("Error deleting task:", error);
    showNotification("Failed to delete task", "error");
  }
}

/**
 * Load tasks from Firestore with real-time updates
 */
function loadTasks() {
  if (!currentUser) return;

  // Unsubscribe from previous listener if exists
  if (unsubscribe) {
    unsubscribe();
  }

  // Create real-time listener for user's tasks
  const q = query(
    collection(db, "tasks"),
    where("userId", "==", currentUser.uid)
  );

  unsubscribe = onSnapshot(
    q,
    (querySnapshot) => {
      tasks = [];
      querySnapshot.forEach((docSnap) => {
        tasks.push({
          firestoreId: docSnap.id,
          ...docSnap.data(),
        });
      });
      renderTasks();
    },
    (error) => {
      console.error("Error loading tasks:", error);
    }
  );
}

// ============================================
// Group Functions
// ============================================

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
async function createGroup(groupName) {
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
      createdAt: new Date(),
      members: [auth.currentUser.uid],
      memberDetails: {
        [auth.currentUser.uid]: {
          email: auth.currentUser.email,
          joinedAt: new Date(),
          role: "owner",
        },
      },
    };

    const groupRef = await addDoc(collection(db, "groups"), groupData);

    // Add group reference to user's document
    const userRef = doc(db, "users", auth.currentUser.uid);
    const userDoc = await getDoc(userRef);

    if (userDoc.exists()) {
      const currentGroups = userDoc.data().groups || [];
      await updateDoc(userRef, {
        groups: [...currentGroups, groupRef.id],
      });
    }

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
async function joinGroup(groupCode) {
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
      members: [...groupData.members, auth.currentUser.uid],
      [`memberDetails.${auth.currentUser.uid}`]: {
        email: auth.currentUser.email,
        joinedAt: new Date(),
        role: "member",
      },
    });

    // Add group to user's document
    const userRef = doc(db, "users", auth.currentUser.uid);
    const userDoc = await getDoc(userRef);

    if (userDoc.exists()) {
      const currentGroups = userDoc.data().groups || [];
      await updateDoc(userRef, {
        groups: [...currentGroups, groupDoc.id],
      });
    }

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
function listenUserGroups(userId, callback) {
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
 * Render user's groups
 */
function renderGroups(groups) {
  const groupsList = document.getElementById("groupsList");

  if (!groupsList) return;

  groupsList.innerHTML = "";

  if (groups.length === 0) {
    groupsList.innerHTML =
      '<p style="color: #666; text-align: center; padding: 20px;">No groups yet. Create or join a group!</p>';
    return;
  }

  groups.forEach((group) => {
    const groupCard = document.createElement("div");
    groupCard.className = "group-card";

    const isOwner = group.createdBy === currentUser.uid;
    const memberCount = group.members ? group.members.length : 0;

    groupCard.innerHTML = `
      <div class="group-card-header">
        <div class="group-name">${group.name}</div>
        <div class="group-role">${isOwner ? "Owner" : "Member"}</div>
      </div>
      <div class="group-info">
        <span class="group-members-count">👥 ${memberCount} member${
      memberCount !== 1 ? "s" : ""
    }</span>
      </div>
    `;

    groupCard.addEventListener("click", () => openGroupDetails(group));
    groupsList.appendChild(groupCard);
  });
}

/**
 * Open group details modal
 */
function openGroupDetails(group) {
  const modal = document.getElementById("groupDetailsModal");
  const title = document.getElementById("groupDetailsTitle");
  const codeDisplay = document.getElementById("groupCodeDisplay");
  const membersList = document.getElementById("groupMembersList");

  title.textContent = group.name;
  codeDisplay.textContent = group.code;

  // Render members
  membersList.innerHTML = "";
  if (group.memberDetails) {
    Object.entries(group.memberDetails).forEach(([userId, details]) => {
      const memberItem = document.createElement("div");
      memberItem.className = "member-item";
      memberItem.textContent = `${details.email} ${
        details.role === "owner" ? "(Owner)" : ""
      }`;
      membersList.appendChild(memberItem);
    });
  }

  modal.style.display = "block";
}

/**
 * Initialize user's groups listener
 */
function initGroupsListener() {
  if (!currentUser) return;

  // Unsubscribe from previous listener
  if (groupsUnsubscribe) {
    groupsUnsubscribe();
  }

  groupsUnsubscribe = listenUserGroups(currentUser.uid, (groups) => {
    userGroups = groups;
    renderGroups(groups);
  });
}

/**
 * Check URL for join code and auto-join
 */
async function checkJoinCode() {
  const urlParams = new URLSearchParams(window.location.search);
  const joinCode = urlParams.get("join");

  if (joinCode && currentUser) {
    await joinGroup(joinCode);
    // Remove join parameter from URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

/**
 * Ensure user document exists in Firestore
 */
async function ensureUserDocument(user) {
  const userRef = doc(db, "users", user.uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists()) {
    await setDoc(userRef, {
      email: user.email,
      createdAt: new Date(),
      groups: [],
    });
  }
}

// ============================================
// Authentication Functions
// ============================================

/**
 * Log out the current user and redirect to login
 */
async function handleLogout() {
  try {
    await signOut(auth);
    console.log("User logged out successfully");
    window.location.href = "/Login.html";
  } catch (error) {
    console.error("Error logging out:", error);
    alert("Failed to logout. Please try again.");
  }
}

// ============================================
// Event Listeners Setup
// ============================================

document.addEventListener("DOMContentLoaded", function () {
  initCalendar();

  // Check authentication state
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      console.log("User logged in:", user.email);

      // Ensure user document exists
      await ensureUserDocument(user);

      // Load tasks and groups
      loadTasks();
      initGroupsListener();

      // Check for join code in URL
      await checkJoinCode();
    } else {
      currentUser = null;
      tasks = [];
      userGroups = [];
      renderTasks();
      console.log("No user logged in");
    }

    // Group Management Event Listeners

    // Create Group Button
    const createGroupBtn = document.getElementById("createGroupBtn");
    if (createGroupBtn) {
      createGroupBtn.addEventListener("click", () => {
        document.getElementById("createGroupModal").style.display = "block";
      });
    }

    // Cancel Create Group
    const cancelCreateGroupBtn = document.getElementById(
      "cancelCreateGroupBtn"
    );
    if (cancelCreateGroupBtn) {
      cancelCreateGroupBtn.addEventListener("click", () => {
        document.getElementById("createGroupModal").style.display = "none";
        document.getElementById("createGroupForm").reset();
      });
    }

    // Create Group Form Submission
    const createGroupForm = document.getElementById("createGroupForm");
    if (createGroupForm) {
      createGroupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const groupName = document.getElementById("groupName").value;

        const result = await createGroup(groupName);

        if (result) {
          document.getElementById("createGroupModal").style.display = "none";
          createGroupForm.reset();
        }
      });
    }

    // Join Group Button
    const joinGroupBtn = document.getElementById("joinGroupBtn");
    if (joinGroupBtn) {
      joinGroupBtn.addEventListener("click", () => {
        document.getElementById("joinGroupModal").style.display = "block";
      });
    }

    // Cancel Join Group
    const cancelJoinGroupBtn = document.getElementById("cancelJoinGroupBtn");
    if (cancelJoinGroupBtn) {
      cancelJoinGroupBtn.addEventListener("click", () => {
        document.getElementById("joinGroupModal").style.display = "none";
        document.getElementById("joinGroupForm").reset();
      });
    }

    // Join Group Form Submission
    const joinGroupForm = document.getElementById("joinGroupForm");
    if (joinGroupForm) {
      joinGroupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const groupCode = document.getElementById("groupCode").value;

        const success = await joinGroup(groupCode);

        if (success) {
          document.getElementById("joinGroupModal").style.display = "none";
          joinGroupForm.reset();
        }
      });
    }

    // Close Group Details
    const closeGroupDetailsBtn = document.getElementById(
      "closeGroupDetailsBtn"
    );
    if (closeGroupDetailsBtn) {
      closeGroupDetailsBtn.addEventListener("click", () => {
        document.getElementById("groupDetailsModal").style.display = "none";
      });
    }

    // Copy Group Code
    const copyCodeBtn = document.getElementById("copyCodeBtn");
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener("click", () => {
        const code = document.getElementById("groupCodeDisplay").textContent;
        navigator.clipboard.writeText(code).then(() => {
          showNotification("Group code copied to clipboard!", "success");
        });
      });
    }
  });

  // Hamburger menu toggle
  const burgerBtn = document.getElementById("burger-btn");
  const dropdownMenu = document.getElementById("dropdown-menu");

  burgerBtn.addEventListener("click", () => {
    dropdownMenu.classList.toggle("show");
  });

  // Close menu when clicking outside
  window.addEventListener("click", (e) => {
    if (!burgerBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
      dropdownMenu.classList.remove("show");
    }
  });

  // Category filter checkboxes
  document.querySelectorAll(".category-filter").forEach((checkbox) => {
    checkbox.addEventListener("change", (e) => {
      const category = e.target.dataset.category;
      const isChecked = e.target.checked;
      updateCategoryFilter(category, isChecked);
    });
  });

  // Logout button
  document.getElementById("logout-btn").addEventListener("click", async () => {
    dropdownMenu.classList.remove("show");
    await handleLogout();
  });

  // Week navigation
  document
    .getElementById("prevWeek")
    .addEventListener("click", () => changeWeek(-1));
  document
    .getElementById("nextWeek")
    .addEventListener("click", () => changeWeek(1));

  // Add task button
  document.getElementById("addBtn").addEventListener("click", openModal);

  // Cancel button
  document.getElementById("cancelBtn").addEventListener("click", closeModal);

  // Task form submission
  document
    .getElementById("taskForm")
    .addEventListener("submit", async function (e) {
      e.preventDefault();

      if (!currentUser) {
        showNotification("Please login first", "error");
        return;
      }

      const taskName = document.getElementById("taskName").value;
      const taskCategory = document.getElementById("taskCategory").value;
      const taskDate = document.getElementById("taskDate").value;
      const taskStartTime = document.getElementById("taskStartTime").value;
      const taskTime = document.getElementById("taskTime").value;

      // If end time is provided, validate that it's after start time
      if (taskTime) {
        const startHour = parseInt(taskStartTime.split(":")[0]);
        const startMinute = parseInt(taskStartTime.split(":")[1]);
        const endHour = parseInt(taskTime.split(":")[0]);
        const endMinute = parseInt(taskTime.split(":")[1]);

        if (
          endHour < startHour ||
          (endHour === startHour && endMinute <= startMinute)
        ) {
          showNotification("End time must be after start time", "error");
          return;
        }
      }

      try {
        const taskData = {
          userId: currentUser.uid,
          name: taskName,
          category: taskCategory,
          date: taskDate,
          startTime: taskStartTime,
          time: taskTime || taskStartTime, // Use startTime as fallback if no end time
          createdAt: new Date(),
        };

        await addDoc(collection(db, "tasks"), taskData);

        showNotification("Task added successfully!", "success");
        closeModal();
      } catch (error) {
        console.error("Error adding task:", error);
        showNotification("Failed to add task", "error");
      }
    });

  // Close modal when clicking outside
  window.addEventListener("click", function (event) {
    const taskModal = document.getElementById("taskModal");
    const createGroupModal = document.getElementById("createGroupModal");
    const joinGroupModal = document.getElementById("joinGroupModal");
    const groupDetailsModal = document.getElementById("groupDetailsModal");

    if (event.target === taskModal) {
      closeModal();
    }
    if (event.target === createGroupModal) {
      createGroupModal.style.display = "none";
    }
    if (event.target === joinGroupModal) {
      joinGroupModal.style.display = "none";
    }
    if (event.target === groupDetailsModal) {
      groupDetailsModal.style.display = "none";
    }
  });
});

/* ============================================
   REMINDER HEADER
   ============================================ */

const switchButtons = document.querySelectorAll(".reminder-switch button");
const switchPill = document.querySelector(".switch-pill");
const reminderList = document.getElementById("reminder-container");
const reminderAddBar = document.getElementById("reminder-add-bar");
const groupReminderList = document.getElementById("group-reminder-container");
const groupReminderAddBar = document.getElementById("group-reminder-add-bar");

switchButtons.forEach((btn, index) => {
  btn.addEventListener("click", () => {
    // update active button
    switchButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // move pill
    if (index === 0) {
      // Personal
      switchPill.classList.remove("right");
      switchPill.classList.add("left");

      reminderList.classList.remove("hidden");
      reminderAddBar.classList.remove("hidden");

      groupReminderList.classList.add("hidden");
      groupReminderAddBar.classList.add("hidden");
    } else {
      // Group
      switchPill.classList.remove("left");
      switchPill.classList.add("right");
      reminderList.classList.add("hidden");
      reminderAddBar.classList.add("hidden");

      groupReminderList.classList.remove("hidden");
      groupReminderAddBar.classList.remove("hidden");
    }

    // later you can use this to change content
    const type = btn.dataset.type; // "group" or "personal"
    console.log("Current reminder type:", type);
  });
});

/* ============================================
   REMINDER CONTENT
   ============================================ */

async function addReminder(
  userId,
  {
    title,
    dueDate = null,
    estimate = null,
    category = "",
    priority = 3,
    eventLink = null,
  }
) {
  if (!title) return console.error("Title is required");
  try {
    const remindersRef = collection(db, "users", userId, "reminders");
    const due = dueDate ? endOfDayLocalFromDate(dueDate) : null;

    await addDoc(remindersRef, {
      title,
      due_date: due,
      estimate_minutes: estimate,
      category,
      priority,
      eventLink,
      is_completed: false,
      finished_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log("Reminder added!");
  } catch (error) {
    console.error("Error adding reminder:", error);
  }
}

function endOfDayLocalFromDate(d) {
  const localDate = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + 1,
    23,
    59,
    0,
    0
  );
  return localDate;
}

function listenUserReminders(userId, callback) {
  const remindersRef = collection(db, "users", userId, "reminders");

  // Optional: order by created_at descending
  const q = query(remindersRef, orderBy("due_date", "asc"));

  // Listen in real-time
  onSnapshot(q, (snapshot) => {
    const reminders = [];
    snapshot.forEach((doc) => {
      reminders.push({ id: doc.id, ...doc.data() });
    });
    callback(reminders); // pass the array to UI renderer
  });
}

async function toggleReminderCompleted(userId, reminderId, currentState) {
  const reminderRef = doc(db, "users", userId, "reminders", reminderId);
  await updateDoc(reminderRef, {
    is_completed: !currentState,
    finished_at: !currentState ? new Date() : null,
    updated_at: new Date(),
  });
}

function createReminderCard(reminder, isPast = false) {
  const card = document.createElement("div");
  card.className = "reminder-card";
  if (reminder.is_completed) card.classList.add("completed");

  // Checkbox
  const checkbox = document.createElement("div");
  checkbox.className = "checkbox-circle";
  if (reminder.is_completed) checkbox.classList.add("checked");
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
    checkbox.classList.toggle("checked");
    card.classList.toggle("completed");
    toggleReminderCompleted(
      auth.currentUser.uid,
      reminder.id,
      reminder.is_completed
    );
  });

  // Content
  const content = document.createElement("div");
  content.className = "reminder-content";

  const title = document.createElement("div");
  title.className = "reminder-title";
  title.textContent = reminder.title;

  const due = document.createElement("div");
  due.className = "reminder-due";

  const finished = document.createElement("div");
  finished.className = "reminder-finished";

  if (reminder.due_date) {
    const date = reminder.due_date.toDate
      ? reminder.due_date.toDate()
      : new Date(reminder.due_date);
    due.textContent = date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    // Red text if past
    if (isPast) {
      due.style.color = "rgba(219, 52, 52, 0.81)";
    }
  }

  // Estimate
  const estimate = document.createElement("div");
  estimate.className = "reminder-estimate";
  estimate.textContent = reminder.estimate_minutes
    ? "Est: " + reminder.estimate_minutes + " min"
    : "";

  // Delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "reminder-delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openDeletePopup(reminder.id);
  });

  // Add finished time if completed
  if (reminder.is_completed && reminder.finished_at) {
    const finishedAt = reminder.finished_at.toDate
      ? reminder.finished_at.toDate()
      : new Date(reminder.finished_at);

    finished.textContent =
      "Completed: " +
      finishedAt.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }) +
      ", " +
      finishedAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
  }

  content.appendChild(title);
  content.appendChild(due);
  if (finished.textContent) {
    content.appendChild(finished);
  }

  card.appendChild(checkbox);
  card.appendChild(content);
  card.appendChild(estimate);
  card.appendChild(deleteBtn);

  return card;
}

function renderReminders(reminders) {
  const listEl = document.getElementById("reminder-list");
  listEl.innerHTML = "";

  const now = new Date();

  // Sort reminders by due date (nulls last)
  reminders.sort((a, b) => {
    const dateA = a.due_date
      ? a.due_date.toDate
        ? a.due_date.toDate()
        : new Date(a.due_date)
      : null;
    const dateB = b.due_date
      ? b.due_date.toDate
        ? b.due_date.toDate()
        : new Date(b.due_date)
      : null;

    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA - dateB;
  });

  // Split sections
  const pastReminders = [];
  const ongoingReminders = [];
  const noAlertReminders = [];
  const completedReminders = [];

  reminders.forEach((reminder) => {
    if (reminder.is_completed) {
      completedReminders.push(reminder);
    } else if (reminder.due_date) {
      const due = reminder.due_date.toDate
        ? reminder.due_date.toDate()
        : new Date(reminder.due_date);
      if (due < now.setHours(0, 0, 0, 0)) pastReminders.push(reminder);
      else ongoingReminders.push(reminder);
    } else {
      noAlertReminders.push(reminder);
    }
  });

  // Sort completed by finished_at (newest first)
  completedReminders.sort((a, b) => {
    const fA = a.finished_at
      ? a.finished_at.toDate
        ? a.finished_at.toDate()
        : new Date(a.finished_at)
      : new Date(0);
    const fB = b.finished_at
      ? b.finished_at.toDate
        ? b.finished_at.toDate()
        : new Date(b.finished_at)
      : new Date(0);
    return fB - fA; // newest first
  });

  // Helper to render a section
  function renderSection(title, arr, isPast = false) {
    if (arr.length === 0) return;

    const divider = document.createElement("div");
    divider.className = "reminder-section-divider";
    divider.textContent = title;
    listEl.appendChild(divider);

    arr.forEach((reminder) => {
      const card = createReminderCard(reminder, isPast);
      listEl.appendChild(card);
    });
  }

  // Render all sections
  renderSection("Past", pastReminders, true);
  renderSection("Ongoing", ongoingReminders);
  renderSection("No alert", noAlertReminders);
  renderSection("Completed", completedReminders);
}

// delete reminder
let pendingDeleteId = null;

function openDeletePopup(reminderId) {
  pendingDeleteId = reminderId;
  document.getElementById("delete-confirm").classList.remove("hidden");
}

function closeDeletePopup() {
  pendingDeleteId = null;
  document.getElementById("delete-confirm").classList.add("hidden");
}

document.getElementById("confirm-yes").addEventListener("click", async () => {
  if (!pendingDeleteId) return;

  try {
    await deleteReminder(auth.currentUser.uid, pendingDeleteId);
  } catch (error) {}
  try {
    await deleteGroupReminder(auth.currentUser.uid, pendingDeleteId);
  } catch (error) {}

  closeDeletePopup();
});

document.getElementById("confirm-no").addEventListener("click", () => {
  closeDeletePopup();
});

async function deleteReminder(uid, reminderId) {
  const ref = doc(db, "users", uid, "reminders", reminderId);
  await deleteDoc(ref);
}

async function deleteGroupReminder(userId, reminderId) {
  try {
    const ref = doc(db, "users", userId, "group_reminders", reminderId);
    await deleteDoc(ref);
    console.log("Group reminder deleted for user:", userId);
  } catch (error) {
    console.error("Error deleting user group reminder:", error);
  }
}

const searchBar = document.getElementById("reminder-search-bar");
const popup = document.getElementById("reminder-popup");
const titleInput = document.getElementById("reminder-title");
const form = document.getElementById("add-reminder-form");
const submitBtn = document.getElementById("reminder-submit");

titleInput.addEventListener("input", () => {
  const hasText = titleInput.value.trim().length > 0;
  submitBtn.disabled = !hasText;
});

// Show popup when search bar clicked
searchBar.addEventListener("click", () => {
  popup.classList.remove("hidden");
  // Focus title input as soon as popup opens
  setTimeout(() => {
    titleInput.focus();
  }, 0);
});

// Close popup when clicking outside the form
document.addEventListener("click", (e) => {
  if (!popup.contains(e.target) && e.target !== searchBar) {
    popup.classList.add("hidden");
  }
});

// Handle form submission

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const title = document.getElementById("reminder-title").value;
  const dueDateValue = document.getElementById("reminder-due").value;
  const estimateValue = document.getElementById("reminder-estimate").value;

  const dueDate = dueDateValue ? new Date(dueDateValue) : null;
  const estimate = estimateValue ? parseInt(estimateValue) : null;

  // For now, category is just a placeholder string
  const category = "General";

  addReminder(auth.currentUser.uid, {
    title,
    dueDate,
    estimate,
    category,
  });

  form.reset();
  popup.classList.add("hidden");
});

// Group reminder
function renderGroupReminders(reminders) {
  const listEl = document.getElementById("group-reminder-list");
  listEl.innerHTML = "";

  const now = new Date();

  // Sort by due_date
  reminders.sort((a, b) => {
    const dateA = a.due_date
      ? a.due_date.toDate
        ? a.due_date.toDate()
        : new Date(a.due_date)
      : null;
    const dateB = b.due_date
      ? b.due_date.toDate
        ? b.due_date.toDate()
        : new Date(b.due_date)
      : null;

    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return dateA - dateB;
  });

  // Split sections
  const pastReminders = [],
    ongoingReminders = [],
    noAlertReminders = [],
    completedReminders = [];

  reminders.forEach((reminder) => {
    if (reminder.is_completed) {
      completedReminders.push(reminder);
    } else if (reminder.due_date) {
      const due = reminder.due_date.toDate
        ? reminder.due_date.toDate()
        : new Date(reminder.due_date);
      if (due < now.setHours(0, 0, 0, 0)) pastReminders.push(reminder);
      else ongoingReminders.push(reminder);
    } else {
      noAlertReminders.push(reminder);
    }
  });

  // Sort completed by finished_at
  completedReminders.sort((a, b) => {
    const fA = a.finished_at
      ? a.finished_at.toDate
        ? a.finished_at.toDate()
        : new Date(a.finished_at)
      : new Date(0);
    const fB = b.finished_at
      ? b.finished_at.toDate
        ? b.finished_at.toDate()
        : new Date(b.finished_at)
      : new Date(0);
    return fB - fA;
  });

  function renderSection(title, arr, isPast = false) {
    if (!arr.length) return;
    const divider = document.createElement("div");
    divider.className = "reminder-section-divider";
    divider.textContent = title;
    listEl.appendChild(divider);

    arr.forEach((reminder) => {
      const card = createGroupReminderCard(reminder, isPast);
      listEl.appendChild(card);
    });
  }

  renderSection("Past", pastReminders, true);
  renderSection("Ongoing", ongoingReminders);
  renderSection("No alert", noAlertReminders);
  renderSection("Completed", completedReminders);
}

function createGroupReminderCard(reminder, isPast = false) {
  const card = document.createElement("div");
  card.className = "reminder-card";
  if (reminder.is_completed) card.classList.add("completed");

  // Checkbox
  const checkbox = document.createElement("div");
  checkbox.className = "checkbox-circle group";
  if (reminder.is_completed) checkbox.classList.add("checked");
  checkbox.addEventListener("click", async (e) => {
    e.stopPropagation();
    checkbox.classList.toggle("checked");
    card.classList.toggle("completed");

    await toggleGroupReminderCompleted(
      auth.currentUser.uid,
      reminder.id,
      reminder.is_completed
    );
    reminder.is_completed = !reminder.is_completed;
  });

  // Content
  const content = document.createElement("div");
  content.className = "reminder-content";

  const title = document.createElement("div");
  title.className = "reminder-title";
  title.textContent = reminder.title;

  const due = document.createElement("div");
  due.className = "reminder-due";

  const finished = document.createElement("div");
  finished.className = "reminder-finished";

  if (reminder.due_date) {
    const date = reminder.due_date.toDate
      ? reminder.due_date.toDate()
      : new Date(reminder.due_date);
    due.textContent = date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (isPast) due.style.color = "rgba(219, 52, 52, 0.81)";
  }

  // Estimate
  const estimate = document.createElement("div");
  estimate.className = "reminder-estimate";
  estimate.textContent = reminder.estimate_minutes
    ? `Est: ${reminder.estimate_minutes} min`
    : "";

  // Delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "reminder-delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    openDeletePopup(reminder.id);
  });

  if (reminder.is_completed && reminder.finished_at) {
    const finishedAt = reminder.finished_at.toDate
      ? reminder.finished_at.toDate()
      : new Date(reminder.finished_at);

    finished.textContent =
      "Completed: " +
      finishedAt.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }) +
      ", " +
      finishedAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
  }

  content.appendChild(title);
  content.appendChild(due);
  content.appendChild(finished);

  card.appendChild(checkbox);
  card.appendChild(content);
  card.appendChild(estimate);
  card.appendChild(deleteBtn);

  return card;
}

function listenUserGroupReminders(userId, callback) {
  const remindersRef = collection(db, "users", userId, "group_reminders");
  const q = query(remindersRef, orderBy("due_date", "asc"));

  onSnapshot(q, (snapshot) => {
    const reminders = [];
    snapshot.forEach((doc) => reminders.push({ id: doc.id, ...doc.data() }));
    callback(reminders);
  });
}

async function toggleGroupReminderCompleted(userId, reminderId, currentState) {
  const reminderRef = doc(db, "users", userId, "group_reminders", reminderId);
  await updateDoc(reminderRef, {
    is_completed: !currentState,
    finished_at: !currentState ? new Date() : null,
    updated_at: new Date(),
  });
}

async function addGroupReminder(
  userId,
  groupId,
  { title, dueDate = null, estimate = null, priority = 3 }
) {
  if (!title) return console.error("Title is required");

  try {
    // 1️⃣ Get group document by ID
    const groupRef = doc(db, "groups", groupId);
    const groupSnap = await getDoc(groupRef);

    if (!groupSnap.exists()) {
      console.error("Group not found:", groupId);
      return;
    }

    const groupData = groupSnap.data();
    const members = groupData.members || [];
    const due = dueDate ? endOfDayLocalFromDate(dueDate) : null;
    // 2️⃣ Add reminder to canonical group_reminders
    const groupReminderRef = await addDoc(
      collection(db, "groups", groupId, "group_reminders"),
      {
        title,
        due_date: due,
        estimate_minutes: estimate || null,
        priority,
        created_at: new Date(),
        updated_at: new Date(),
        created_by: userId,
      }
    );

    const reminderId = groupReminderRef.id;

    // 3️⃣ Fan-out to each user
    for (const memberId of members) {
      await setDoc(doc(db, "users", memberId, "group_reminders", reminderId), {
        title,
        due_date: dueDate || null,
        estimate_minutes: estimate || null,
        priority,
        created_at: new Date(),
        updated_at: new Date(),
        group_id: groupId,
        reminder_id: reminderId,
        is_completed: false,
        finished_at: null,
        eventLink: null,
      });
    }

    console.log("Group reminder added successfully!");
  } catch (error) {
    console.error("Error adding group reminder:", error);
  }
}

// =============================
// Group Reminder Add UI
// =============================

// Elements
const groupSearchBar = document.getElementById("group-reminder-search-bar");
const groupPopup = document.getElementById("group-reminder-popup");
const groupTitleInput = document.getElementById("group-reminder-title");
const groupForm = document.getElementById("group-add-reminder-form");
const groupSubmitBtn = document.getElementById("group-reminder-submit");

// Disable/enable submit based on input text
groupTitleInput.addEventListener("input", () => {
  const hasText = groupTitleInput.value.trim().length > 0;
  groupSubmitBtn.disabled = !hasText;
});

// Show popup when search bar clicked
groupSearchBar.addEventListener("click", () => {
  groupPopup.classList.remove("hidden");

  // Focus title input as soon as popup opens
  setTimeout(() => {
    groupTitleInput.focus();
  }, 0);
});

// Close popup when clicking outside the form
document.addEventListener("click", (e) => {
  if (!groupPopup.contains(e.target) && e.target !== groupSearchBar) {
    groupPopup.classList.add("hidden");
  }
});

// Handle form submission
groupForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Get values
  const title = document.getElementById("group-reminder-title").value;
  const dueDateValue = document.getElementById("group-reminder-due").value;
  const estimateValue = document.getElementById(
    "group-reminder-estimate"
  ).value;

  const dueDate = dueDateValue ? new Date(dueDateValue) : null;
  const estimate = estimateValue ? parseInt(estimateValue) : null;

  // placeholder category
  const category = "General";

  // Get user + group info
  const user = auth.currentUser;
  if (!user) {
    console.error("No user logged in");
    return;
  }

  // ★ Replace this with your actual selected group
  const groupId = window.currentGroupId || "VH20KHJeRtMZMZh87UKe";

  try {
    await addGroupReminder(user.uid, groupId, {
      title,
      dueDate,
      estimate,
      category,
    });

    console.log("Group reminder added!");
  } catch (err) {
    console.error("Error adding group reminder:", err);
  }

  groupForm.reset();
  groupPopup.classList.add("hidden");
});

// ---------------------------------
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("Logged in user:", user.uid);

    // Now it's safe to call
    const userId = user.uid;
    const groupCode = "V85REVD7";

    // addGroupReminder(userId, groupCode, {
    //   title: "Team Sync Meeting",
    //   dueDate: new Date("2025-12-06T10:30:00"),
    //   estimate: 45,
    //   priority: 3,
    // });
    listenUserReminders(user.uid, renderReminders);
    listenUserGroupReminders(user.uid, renderGroupReminders);
  } else {
    console.log("No user logged in yet");
  }
});

// auto schedule
document
  .getElementById("auto-schedule-btn")
  .addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) {
      console.error("No current user for auto-schedule");
      return;
    }

    await autoSchedule(user.uid);
  });

async function getUncompletedReminders(userId) {
  const remindersRef = collection(db, "users", userId, "reminders");
  const q = query(
    remindersRef,
    where("completed", "==", false),
    where("alert", "==", true)
  );
  const snap = await getDocs(q);

  let reminders = [];

  snap.forEach((doc) => {
    const data = doc.data();
    if (data.estimateTime && data.dueDate) {
      // ignore ones without estimate time
      reminders.push({
        id: doc.id,
        ...data,
      });
    }
  });

  return reminders;
}

async function getExistingTasks(userId) {
  const tasksRef = collection(db, "tasks");
  const q = query(tasksRef, where("userId", "==", userId));
  const snap = await getDocs(q);

  let tasks = [];

  snap.forEach((doc) => {
    tasks.push({
      id: doc.id,
      ...doc.data(),
    });
  });

  return tasks;
}

function getDaySlots(dateStr) {
  const slots = [];
  let start = dayjs(dateStr + " 18:00");
  let end = dayjs(dateStr + " 23:59");

  while (start.isBefore(end)) {
    const next = start.add(30, "minute");
    slots.push({
      start,
      end: next,
    });
    start = next;
  }
  return slots;
}
function blockOccupiedSlots(slots, tasks, dateStr) {
  const dayTasks = tasks.filter((t) => t.date === dateStr);

  return slots.filter((slot) => {
    return !dayTasks.some((t) => {
      const taskStart = dayjs(t.date + " " + t.startTime);
      const taskEnd = dayjs(t.date + " " + t.endTime);

      return slot.start.isBefore(taskEnd) && slot.end.isAfter(taskStart);
    });
  });
}

async function autoSchedule(userId) {
  if (!userId) {
    console.error("autoSchedule: missing userId");
    return;
  }

  console.log("Start auto-schedule...");

  // 1️⃣ Load reminders and tasks
  const reminders = await getUnscheduledReminders(userId); // reminders with due date and estimate
  const tasks = await getExistingTasks(userId); // all tasks

  console.log("Loaded reminders:", reminders.length);
  console.log("Loaded tasks:", tasks.length);

  // 2️⃣ Build busy slots map
  const busy = buildBusySlots(tasks); // { date: [{start, end}, ...] }

  // 3️⃣ Sort reminders: overdue first, then nearest due date
  const now = new Date();
  reminders.sort((a, b) => {
    const da = new Date(a.dueDate);
    const db = new Date(b.dueDate);
    return da - db;
  });

  for (const r of reminders) {
    const duration = r.estimate;
    if (!r.dueDate || !duration) continue;

    const dueDateObj = new Date(r.dueDate);
    const today = new Date();
    let iterDate = new Date(Math.min(today.getTime(), dueDateObj.getTime())); // start today or overdue

    let scheduled = false;
    while (iterDate <= dueDateObj && !scheduled) {
      const dateStr = iterDate.toISOString().slice(0, 10);

      const slot = findSlotForEstimate(busy, dateStr, duration);

      if (slot) {
        let taskId;
        if (r.eventLink) {
          await updateTask(r.eventLink, {
            date: dateStr,
            startTime: slot.start,
            endTime: slot.end,
            category: "work",
          });
          taskId = r.eventLink;
          console.log("Updated task:", r.title);
        } else {
          taskId = await createTask({
            userId,
            name: r.title,
            date: dateStr,
            startTime: slot.start,
            endTime: slot.end,
            category: "work",
          });
          await updateReminderLink(userId, r, taskId);
          console.log("Created task:", r.title);
        }

        if (!busy[dateStr]) busy[dateStr] = [];
        busy[dateStr].push({ start: slot.start, end: slot.end });

        scheduled = true;
      }

      iterDate.setDate(iterDate.getDate() + 1);
    }

    if (!scheduled) {
      console.log("No space to schedule reminder:", r.title);
    }
  }

  console.log("Auto schedule complete");
}

async function createTask({ userId, name, date, startTime, endTime }) {
  const taskData = {
    userId,
    name,
    category: "work", // default
    date,
    startTime,
    time: endTime,
    createdAt: new Date(),
  };

  const ref = await addDoc(collection(db, "tasks"), taskData);
  return ref.id;
}

async function updateTask(taskId, { date, startTime, endTime }) {
  await updateDoc(doc(db, "tasks", taskId), {
    date,
    startTime,
    time: endTime,
  });
}

async function updateReminderLink(userId, reminder, taskId) {
  const id = reminder.id;
  const path =
    reminder.type === "group"
      ? doc(db, "users", userId, "group_reminders", id)
      : doc(db, "users", userId, "reminders", id);

  await updateDoc(path, { eventLink: taskId, updated_at: new Date() });
}

// Build busy slots from existing tasks
function buildBusySlots(tasks) {
  const slots = {};
  for (const task of tasks) {
    const { date, startTime, time } = task;
    if (!slots[date]) slots[date] = [];
    slots[date].push({ start: startTime, end: time });
  }
  return slots;
}

function findSlotForEstimate(busy, date, duration) {
  const startOfDay = 18 * 60; // 18:00 in minutes
  const endOfDay = 24 * 60; // 24:00 in minutes

  if (!busy[date]) busy[date] = [];

  // Convert existing slots to minutes and sort
  const slots = busy[date].map((s) => ({
    start: timeToMinutes(s.start),
    end: timeToMinutes(s.end),
  }));
  slots.sort((a, b) => a.start - b.start);

  // Add a dummy slot at the end of day
  slots.push({ start: endOfDay, end: endOfDay });

  let cursor = startOfDay;

  for (const slot of slots) {
    // While there is space before this busy slot
    while (cursor + duration <= slot.start) {
      // We found a free slot
      return {
        start: minutesToTime(cursor),
        end: minutesToTime(cursor + duration),
      };
    }
    // Move cursor to end of this busy slot
    cursor = Math.max(cursor, slot.end);
  }

  // If no slot found today, return null
  return null;
}

// Helper: convert "HH:MM" to minutes
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

// --- Helper: convert minutes -> HH:MM ---
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function getUnscheduledReminders(userId) {
  if (!userId) {
    console.error("No userId found in getUnscheduledReminders");
    return [];
  }

  const personalRef = collection(db, "users", userId, "reminders");
  const groupRef = collection(db, "users", userId, "group_reminders");

  const [personalSnap, groupSnap] = await Promise.all([
    getDocs(personalRef),
    getDocs(groupRef),
  ]);

  const reminders = [];

  // PERSONAL
  personalSnap.forEach((doc) => {
    const data = doc.data();

    if (!data.is_completed && data.due_date && data.estimate_minutes) {
      reminders.push({
        id: doc.id,
        title: data.title,
        dueDate: normalizeDate(data.due_date),
        estimate: data.estimate_minutes,
        eventLink: data.eventLink || null,
        type: "personal",
      });
    }
  });

  // GROUP
  groupSnap.forEach((doc) => {
    const data = doc.data();

    if (!data.is_completed && data.due_date && data.estimate_minutes) {
      reminders.push({
        id: doc.id,
        title: data.title,
        dueDate: normalizeDate(data.due_date),
        estimate: data.estimate_minutes,
        eventLink: data.eventLink || null,
        type: "group",
      });
    }
  });

  return reminders;
}

function normalizeDate(d) {
  if (!d) return null;

  // Firestore Timestamp
  if (d.toDate) {
    const date = d.toDate();
    return date.toISOString().split("T")[0]; // "YYYY-MM-DD"
  }

  // string already
  if (typeof d === "string") {
    return d.split("T")[0]; // safe trim
  }

  return null;
}
