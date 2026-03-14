import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listUsers,
  updateUser,
  listBookings,
  getStats,
} from "../controllers/admin.js";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/users", listUsers);
router.patch("/users/:id", updateUser);
router.get("/bookings", listBookings);
router.get("/stats", getStats);

export default router;
