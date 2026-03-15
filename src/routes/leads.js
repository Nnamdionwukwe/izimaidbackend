import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createLead,
  listLeads,
  getLead,
  updateLeadStatus,
} from "../controllers/leads.controller.js";

const router = Router();

// Public — anyone can submit a lead
router.post("/", createLead);

// Admin only
router.get("/", requireAuth, requireRole("admin"), listLeads);
router.get("/:id", requireAuth, requireRole("admin"), getLead);
router.patch("/:id", requireAuth, requireRole("admin"), updateLeadStatus);

export default router;
