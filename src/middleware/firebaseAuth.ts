import admin from 'firebase-admin';
import type { Request, Response, NextFunction } from 'express';

// Extend Express Request with user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Minimal shape we need downstream
    interface UserInfo {
      uid: string;
    }
    interface Request {
      user?: UserInfo;
    }
  }
}

let initialized = false;
function initFirebaseAdmin() {
  if (initialized) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[Auth] Firebase admin env not fully set; auth endpoints will reject');
    initialized = true; // avoid re-attempt spam
    return;
  }
  // Render env often ships PRIVATE_KEY with literal \n
  privateKey = privateKey.replace(/\\n/g, '\n');
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
    initialized = true;
  } catch (e) {
    // If already initialized, ignore
    if ((e as any)?.message && String((e as any).message).includes('already exists')) {
      initialized = true;
      return;
    }
    console.error('[Auth] Firebase admin init failed:', e);
    initialized = true;
  }
}

export async function firebaseAuth(req: Request, res: Response, next: NextFunction) {
  initFirebaseAdmin();
  try {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing bearer token' });
    }
    const idToken = header.slice('Bearer '.length).trim();
    if (!idToken) {
      return res.status(401).json({ error: 'invalid bearer token' });
    }
    if (!admin.apps.length) {
      return res.status(500).json({ error: 'auth not initialized' });
    }
    const decoded = await admin.auth().verifyIdToken(idToken);
    (req as any).user = { uid: decoded.uid };
    return next();
  } catch (e: any) {
    const msg = e?.message || String(e);
    return res.status(401).json({ error: 'unauthorized', detail: msg });
  }
}

