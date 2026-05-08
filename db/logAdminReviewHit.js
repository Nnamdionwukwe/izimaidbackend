// db/logAdminReviewHit.js
import express from "express";

export default function debugReviewHook(req, res, next) {
  console.log("\n📥 ADMIN REVIEW HIT");
  console.log("docId from params:", req.params.docId);
  console.log("status from body:", req.body.status);
  console.log("admin_notes:", req.body.admin_notes);
  console.log("───────────────\n");
  next();
}
