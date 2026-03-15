import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createLead,
  listLeads,
  updateLeadStatus,
} from "../controllers/leads.controller.js";

const router = Router();

router.post("/", createLead); // public
router.get("/", requireAuth, requireRole("admin"), listLeads); // admin only
router.patch(
  "/:id/status",
  requireAuth,
  requireRole("admin"),
  updateLeadStatus,
); // admin only

export default router;
