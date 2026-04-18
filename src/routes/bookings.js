import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createBooking,
  listBookings,
  getBooking,
  updateStatus,
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
  updateBookingStatus,
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

// ─── SOS (admin) ─────────────────────────────────────────────────────
router.get("/sos", requireAuth, requireRole("admin"), getSOSAlerts);
router.patch(
  "/sos/:alertId/resolve",
  requireAuth,
  requireRole("admin"),
  resolveSOSAlert,
);

// ─── Core bookings ────────────────────────────────────────────────────
router.post("/", requireAuth, requireRole("customer"), createBooking);
router.get("/", requireAuth, listBookings);
router.get("/:id", requireAuth, getBooking);
router.patch("/:id/status", requireAuth, updateStatus);
router.post("/:id/review", requireAuth, requireRole("customer"), submitReview);

// ─── Job activity ─────────────────────────────────────────────────────
router.post("/:id/checkin", requireAuth, requireRole("maid"), checkIn);
router.post("/:id/checkout", requireAuth, requireRole("maid"), checkOut);
router.post("/:id/location", requireAuth, requireRole("maid"), updateLocation);
router.get("/:id/location", requireAuth, getJobLocation);
router.post("/:id/sos", requireAuth, triggerSOS);
router.post("/:id/video-call", requireAuth, initiateVideoCall);
router.patch("/:id/status", requireAuth, updateBookingStatus);

export default router;
