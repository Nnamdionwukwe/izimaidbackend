import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createBooking,
  listBookings,
  getBooking,
  updateBookingStatus,
  submitReview,
  checkIn,
  checkOut,
  updateLocation,
  getJobLocation,
  triggerSOS,
  resolveSOSAlert,
  getSOSAlerts,
  initiateVideoCall,
  setEmergencyContact,
  getEmergencyContacts,
  deleteEmergencyContact,
  getVideoCallStatus,
  endVideoCall,
  getActiveCallForUser,
  savePushToken,
} from "../controllers/bookings.js";

const router = Router();

// ─── Emergency contacts (must come before /:id) ───────────────────────
router.get("/emergency-contacts", requireAuth, getEmergencyContacts);
router.post("/emergency-contacts", requireAuth, setEmergencyContact);
router.delete(
  "/emergency-contacts/:contactId",
  requireAuth,
  deleteEmergencyContact,
);

// ─── SOS (admin) ──────────────────────────────────────────────────────
router.get("/sos", requireAuth, requireRole("admin"), getSOSAlerts);
router.patch(
  "/sos/:alertId/resolve",
  requireAuth,
  requireRole("admin"),
  resolveSOSAlert,
);

// ─── Core bookings ─────────────────────────────────────────────────────
router.post("/", requireAuth, requireRole("customer"), createBooking);
router.get("/", requireAuth, listBookings);
router.get("/:id", requireAuth, getBooking);
router.patch("/:id/status", requireAuth, updateBookingStatus); // ← only once
router.post("/:id/review", requireAuth, requireRole("customer"), submitReview);

// ─── Job activity ──────────────────────────────────────────────────────
router.post("/:id/checkin", requireAuth, requireRole("maid"), checkIn);
router.post("/:id/checkout", requireAuth, requireRole("maid"), checkOut);
router.post("/:id/location", requireAuth, requireRole("maid"), updateLocation);
router.get("/:id/location", requireAuth, getJobLocation);
router.post("/:id/sos", requireAuth, triggerSOS);
// ─── Video call ────────────────────────────────────────────────────────
router.get("/active-call", requireAuth, getActiveCallForUser);
router.post("/:id/video-call", requireAuth, initiateVideoCall);
router.get("/:id/video-call", requireAuth, getVideoCallStatus);
router.delete("/:id/video-call", requireAuth, endVideoCall);

export default router;
