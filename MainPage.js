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
    await deleteDoc(doc(db, "tasks", firestoreId));
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
    } else {
      // Group
      switchPill.classList.remove("left");
      switchPill.classList.add("right");
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
    await addDoc(remindersRef, {
      title,
      due_date: dueDate ? dueDate : null,
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
    callback(reminders); // pass the array to your UI renderer
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

function renderReminders(reminders) {
  const listEl = document.getElementById("reminder-list");
  listEl.innerHTML = "";

  reminders.forEach((reminder) => {
    // Card container
    const card = document.createElement("div");
    card.className = "reminder-card";

    // Left: checkbox
    const checkbox = document.createElement("div");
    checkbox.className = "checkbox-circle";
    if (reminder.is_completed) checkbox.classList.add("checked");

    // Right: title + due date
    const content = document.createElement("div");
    content.className = "reminder-content";

    const title = document.createElement("div");
    title.className = "reminder-title";
    title.textContent = reminder.title;

    const due = document.createElement("div");
    due.className = "reminder-due";
    if (reminder.due_date) {
      const date = reminder.due_date.toDate
        ? reminder.due_date.toDate()
        : new Date(reminder.due_date);
      due.textContent = date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } else {
      due.textContent = "";
    }

    content.appendChild(title);
    content.appendChild(due);

    // Combine checkbox + content
    card.appendChild(checkbox);
    card.appendChild(content);

    // Click to toggle completion
    card.addEventListener("click", () => {
      toggleReminderCompleted(
        auth.currentUser.uid,
        reminder.id,
        reminder.is_completed
      );
    });

    listEl.appendChild(card);
  });
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("Logged in user:", user.uid);
    listenUserReminders(user.uid, renderReminders);
  } else {
    console.log("No user logged in yet");
  }
});

const searchBar = document.getElementById("reminder-search-bar");
const popup = document.getElementById("reminder-popup");
const titleInput = document.getElementById("reminder-title");
const form = document.getElementById("add-reminder-form");

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
