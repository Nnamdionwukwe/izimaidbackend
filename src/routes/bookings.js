import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createBooking,
  listBookings,
  getBooking,
  updateStatus,
  submitReview,
} from "../controllers/bookings.js";

const router = Router();

router.post("/", requireAuth, requireRole("customer"), createBooking);
router.get("/", requireAuth, listBookings);
router.get("/:id", requireAuth, getBooking);
router.patch("/:id/status", requireAuth, updateStatus);
router.post("/:id/review", requireAuth, requireRole("customer"), submitReview);

export default router;
