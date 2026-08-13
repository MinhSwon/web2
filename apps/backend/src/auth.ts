import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config";

export type AuthUser = { id: string; email: string; role: string };
export type AuthRequest = Request & { user?: AuthUser };

export function signToken(user: AuthUser) {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const value = req.header("authorization");
  if (!value?.startsWith("Bearer ")) return res.status(401).json({ error: "AUTH_REQUIRED" });
  try {
    req.user = jwt.verify(value.slice(7), config.JWT_SECRET) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

export function requireWorker(req: Request, res: Response, next: NextFunction) {
  if (req.header("x-worker-token") !== config.WORKER_TOKEN) {
    return res.status(401).json({ error: "INVALID_WORKER_TOKEN" });
  }
  next();
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "ADMIN_REQUIRED" });
  }
  next();
}

