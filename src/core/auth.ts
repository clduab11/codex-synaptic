/**
 * Authentication and Authorization system for Codex-Synaptic
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Logger } from './logger.js';
import { CodexSynapticError, ErrorCode } from './errors.js';

export interface User {
  id: string;
  username: string;
  email?: string;
  roles: string[];
  permissions: string[];
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface AuthToken {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface Permission {
  name: string;
  description: string;
  resource: string;
  action: string;
}

export interface Role {
  name: string;
  description: string;
  permissions: string[];
}

export class AuthenticationManager {
  private logger = Logger.getInstance();
  private users: Map<string, User> = new Map();
  private tokens: Map<string, AuthToken> = new Map();
  private roles: Map<string, Role> = new Map();
  private permissions: Map<string, Permission> = new Map();
  private passwordHashes: Map<string, string> = new Map();
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    this.initializeDefaultRoles();
    this.initializeDefaultUsers();
  }

  private initializeDefaultRoles(): void {
    // Define default permissions
    const permissions: Permission[] = [
      { name: 'system.read', description: 'Read system status', resource: 'system', action: 'read' },
      { name: 'system.write', description: 'Modify system settings', resource: 'system', action: 'write' },
      { name: 'agent.read', description: 'Read agent information', resource: 'agent', action: 'read' },
      { name: 'agent.write', description: 'Manage agents', resource: 'agent', action: 'write' },
      { name: 'agent.deploy', description: 'Deploy new agents', resource: 'agent', action: 'deploy' },
      { name: 'task.read', description: 'Read task information', resource: 'task', action: 'read' },
      { name: 'task.write', description: 'Submit and manage tasks', resource: 'task', action: 'write' },
      { name: 'swarm.read', description: 'Read swarm status', resource: 'swarm', action: 'read' },
      { name: 'swarm.write', description: 'Control swarm operations', resource: 'swarm', action: 'write' },
      { name: 'consensus.read', description: 'Read consensus proposals', resource: 'consensus', action: 'read' },
      { name: 'consensus.write', description: 'Create proposals and vote', resource: 'consensus', action: 'write' },
      { name: 'bridge.read', description: 'Read bridge status', resource: 'bridge', action: 'read' },
      { name: 'bridge.write', description: 'Configure bridges', resource: 'bridge', action: 'write' },
      { name: 'admin.all', description: 'Full administrative access', resource: '*', action: '*' }
    ];

    permissions.forEach(perm => this.permissions.set(perm.name, perm));

    // Define default roles
    const roles: Role[] = [
      {
        name: 'admin',
        description: 'Full system administrator',
        permissions: ['admin.all']
      },
      {
        name: 'operator',
        description: 'System operator with read/write access',
        permissions: [
          'system.read', 'system.write',
          'agent.read', 'agent.write', 'agent.deploy',
          'task.read', 'task.write',
          'swarm.read', 'swarm.write',
          'consensus.read', 'consensus.write',
          'bridge.read', 'bridge.write'
        ]
      },
      {
        name: 'user',
        description: 'Regular user with task and read permissions',
        permissions: [
          'system.read',
          'agent.read',
          'task.read', 'task.write',
          'swarm.read',
          'consensus.read',
          'bridge.read'
        ]
      },
      {
        name: 'readonly',
        description: 'Read-only access to system',
        permissions: [
          'system.read',
          'agent.read',
          'task.read',
          'swarm.read',
          'consensus.read',
          'bridge.read'
        ]
      }
    ];

    roles.forEach(role => this.roles.set(role.name, role));
  }

  private initializeDefaultUsers(): void {
    // Create default admin user
    const adminUser: User = {
      id: 'admin-001',
      username: 'admin',
      email: 'admin@codex-synaptic.local',
      roles: ['admin'],
      permissions: this.getUserPermissions(['admin']),
      createdAt: new Date()
    };

    this.users.set(adminUser.id, adminUser);
    
    // Generate secure random password or use environment variable
    const adminPassword = process.env.CODEX_ADMIN_PASSWORD;
    if (!adminPassword) {
      // Generate a secure random password for the admin user
      const randomPassword = randomBytes(16).toString('base64').replace(/[+/=]/g, '').substring(0, 16);
      this.passwordHashes.set(adminUser.id, this.hashPassword(randomPassword));
      this.logger.warn('auth', 'Admin user created with generated password. Set CODEX_ADMIN_PASSWORD environment variable for production', { 
        username: adminUser.username,
        generatedPassword: randomPassword 
      });
    } else {
      this.passwordHashes.set(adminUser.id, this.hashPassword(adminPassword));
      this.logger.info('auth', 'Admin user created with configured password', { username: adminUser.username });
    }
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(password + salt).digest('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, storedHash: string): boolean {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    
    const candidateHash = createHash('sha256').update(password + salt).digest('hex');
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidateHash, 'hex'));
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private getUserPermissions(roles: string[]): string[] {
    const permissions = new Set<string>();
    
    roles.forEach(roleName => {
      const role = this.roles.get(roleName);
      if (role) {
        role.permissions.forEach(perm => {
          if (perm === 'admin.all') {
            // Admin gets all permissions
            this.permissions.forEach((_, permName) => permissions.add(permName));
          } else {
            permissions.add(perm);
          }
        });
      }
    });
    
    return Array.from(permissions);
  }

  async authenticate(username: string, password: string): Promise<{ user: User; token: string }> {
    // Find user by username
    const user = Array.from(this.users.values()).find(u => u.username === username);
    if (!user) {
      this.logger.warn('auth', 'Authentication failed - user not found', { username });
      throw new CodexSynapticError(
        ErrorCode.AGENT_NOT_FOUND,
        'Invalid credentials',
        { username },
        false
      );
    }

    // Verify password
    const storedHash = this.passwordHashes.get(user.id);
    if (!storedHash || !this.verifyPassword(password, storedHash)) {
      this.logger.warn('auth', 'Authentication failed - invalid password', { username });
      throw new CodexSynapticError(
        ErrorCode.AGENT_NOT_FOUND,
        'Invalid credentials',
        { username },
        false
      );
    }

    // Generate token
    const token = this.generateToken();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    
    const authToken: AuthToken = {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      createdAt: new Date(),
      lastUsedAt: new Date()
    };

    this.tokens.set(token, authToken);
    
    // Update user last login
    user.lastLoginAt = new Date();

    this.logger.info('auth', 'User authenticated successfully', { 
      username, 
      userId: user.id 
    });

    return { user, token };
  }

  async validateToken(token: string): Promise<User> {
    const authToken = this.tokens.get(token);
    if (!authToken) {
      throw new CodexSynapticError(
        ErrorCode.AGENT_NOT_FOUND,
        'Invalid token',
        { token: token.substring(0, 8) + '...' },
        false
      );
    }

    // Check expiration
    if (authToken.expiresAt < new Date()) {
      this.tokens.delete(token);
      throw new CodexSynapticError(
        ErrorCode.AGENT_TIMEOUT,
        'Token expired',
        { token: token.substring(0, 8) + '...' },
        false
      );
    }

    // Update last used
    authToken.lastUsedAt = new Date();

    const user = this.users.get(authToken.userId);
    if (!user) {
      this.tokens.delete(token);
      throw new CodexSynapticError(
        ErrorCode.AGENT_NOT_FOUND,
        'User not found for token',
        { userId: authToken.userId },
        false
      );
    }

    return user;
  }

  async authorize(user: User, resource: string, action: string): Promise<boolean> {
    // Check if user has admin permission
    if (user.permissions.includes('admin.all')) {
      return true;
    }

    // Check specific permission
    const requiredPermission = `${resource}.${action}`;
    const hasPermission = user.permissions.includes(requiredPermission);

    if (!hasPermission) {
      this.logger.warn('auth', 'Authorization failed', {
        userId: user.id,
        username: user.username,
        resource,
        action,
        requiredPermission,
        userPermissions: user.permissions
      });
    }

    return hasPermission;
  }

  async revokeToken(token: string): Promise<void> {
    const authToken = this.tokens.get(token);
    if (authToken) {
      this.tokens.delete(token);
      this.logger.info('auth', 'Token revoked', { userId: authToken.userId });
    }
  }

  async createUser(userData: {
    username: string;
    email?: string;
    password: string;
    roles: string[];
  }): Promise<User> {
    // Check if username already exists
    const existingUser = Array.from(this.users.values()).find(u => u.username === userData.username);
    if (existingUser) {
      throw new CodexSynapticError(
        ErrorCode.AGENT_EXECUTION_FAILED,
        'Username already exists',
        { username: userData.username },
        false
      );
    }

    // Validate roles
    const invalidRoles = userData.roles.filter(role => !this.roles.has(role));
    if (invalidRoles.length > 0) {
      throw new CodexSynapticError(
        ErrorCode.AGENT_EXECUTION_FAILED,
        'Invalid roles specified',
        { invalidRoles },
        false
      );
    }

    const user: User = {
      id: `user-${randomBytes(8).toString('hex')}`,
      username: userData.username,
      email: userData.email,
      roles: userData.roles,
      permissions: this.getUserPermissions(userData.roles),
      createdAt: new Date()
    };

    this.users.set(user.id, user);
    this.passwordHashes.set(user.id, this.hashPassword(userData.password));

    this.logger.info('auth', 'User created', {
      userId: user.id,
      username: user.username,
      roles: user.roles
    });

    return user;
  }

  getUsers(): User[] {
    return Array.from(this.users.values());
  }

  getRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  getPermissions(): Permission[] {
    return Array.from(this.permissions.values());
  }

  // Clean up expired tokens
  cleanupExpiredTokens(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [token, authToken] of this.tokens) {
      if (authToken.expiresAt < now) {
        this.tokens.delete(token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info('auth', `Cleaned up ${cleaned} expired tokens`);
    }
  }

  // Start periodic cleanup
  startPeriodicCleanup(intervalMs: number = 60 * 60 * 1000): void { // 1 hour
    if (this.cleanupInterval) {
      this.logger.warn('auth', 'Token cleanup already scheduled');
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, intervalMs);

    this.logger.info('auth', `Started periodic token cleanup (${intervalMs}ms interval)`);
  }

  stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      this.logger.info('auth', 'Stopped periodic token cleanup');
    }
  }
}

/**
 * Middleware for authentication and authorization
 */
export class AuthMiddleware {
  constructor(private authManager: AuthenticationManager) {}

  async authenticate(token?: string): Promise<User> {
    if (!token) {
      throw new CodexSynapticError(
        ErrorCode.AGENT_NOT_FOUND,
        'Authentication required',
        undefined,
        false
      );
    }

    return await this.authManager.validateToken(token);
  }

  async authorize(user: User, resource: string, action: string): Promise<void> {
    const authorized = await this.authManager.authorize(user, resource, action);
    if (!authorized) {
      throw new CodexSynapticError(
        ErrorCode.AGENT_EXECUTION_FAILED,
        'Insufficient permissions',
        { resource, action, userRoles: user.roles },
        false
      );
    }
  }

  async authenticateAndAuthorize(token: string | undefined, resource: string, action: string): Promise<User> {
    const user = await this.authenticate(token);
    await this.authorize(user, resource, action);
    return user;
  }
}