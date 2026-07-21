import jwt from 'jsonwebtoken';

export interface AuthIdentity {
  id: string;
  email: string;
  role: string;
  name: string;
}

const KNOWN_INSECURE_SECRETS = new Set([
  'fallback_dev_secret_change_in_production',
]);

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32 || KNOWN_INSECURE_SECRETS.has(secret)) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters');
  }
  return secret;
}

export function assertJwtConfiguration(): void {
  getJwtSecret();
}

export function verifyAccessToken(token: string): AuthIdentity {
  const decoded = jwt.verify(token, getJwtSecret());
  if (
    typeof decoded !== 'object' ||
    !decoded ||
    typeof decoded.id !== 'string' ||
    typeof decoded.email !== 'string' ||
    typeof decoded.role !== 'string' ||
    typeof decoded.name !== 'string'
  ) {
    throw new Error('Invalid token payload');
  }
  return decoded as AuthIdentity;
}
