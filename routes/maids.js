import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listMaids,
  getMaid,
  updateProfile,
  getMaidReviews,
} from "../controllers/maids.js";

const router = Router();

router.get("/", listMaids);
router.get("/:id", getMaid);
router.get("/:id/reviews", getMaidReviews);
router.patch("/profile", requireAuth, requireRole("maid"), updateProfile);

export default router;
