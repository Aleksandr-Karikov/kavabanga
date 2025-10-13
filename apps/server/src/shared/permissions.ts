export enum Permission {
  // ==================== USER PERMISSIONS ====================
  USER_CREATE = "user:create",
  USER_READ = "user:read",
  USER_UPDATE = "user:update",
  USER_DELETE = "user:delete",
  USER_LIST = "user:list",
  USER_ASSIGN_ROLE = "user:assign_role",
  USER_REMOVE_ROLE = "user:remove_role",
  USER_ACTIVATE = "user:activate",
  USER_DEACTIVATE = "user:deactivate",

  // ==================== ROLE PERMISSIONS ====================
  ROLE_CREATE = "role:create",
  ROLE_READ = "role:read",
  ROLE_UPDATE = "role:update",
  ROLE_DELETE = "role:delete",
  ROLE_LIST = "role:list",
  ROLE_ASSIGN_PERMISSION = "role:assign_permission",
  ROLE_REMOVE_PERMISSION = "role:remove_permission",

  // ==================== ADMIN PERMISSIONS ====================
  ADMIN_ACCESS = "admin:access",
  ADMIN_SETTINGS = "admin:settings",
  ADMIN_LOGS = "admin:logs",
  ADMIN_SYSTEM = "admin:system",
  ADMIN_DASHBOARD = "admin:dashboard",

  // ==================== CONTENT PERMISSIONS ====================
  CONTENT_CREATE = "content:create",
  CONTENT_READ = "content:read",
  CONTENT_UPDATE = "content:update",
  CONTENT_DELETE = "content:delete",
  CONTENT_LIST = "content:list",
  CONTENT_PUBLISH = "content:publish",
  CONTENT_UNPUBLISH = "content:unpublish",
  CONTENT_MODERATE = "content:moderate",

  // ==================== COMMENT PERMISSIONS ====================
  COMMENT_CREATE = "comment:create",
  COMMENT_READ = "comment:read",
  COMMENT_UPDATE = "comment:update",
  COMMENT_DELETE = "comment:delete",
  COMMENT_MODERATE = "comment:moderate",

  // ==================== FILE PERMISSIONS ====================
  FILE_UPLOAD = "file:upload",
  FILE_DOWNLOAD = "file:download",
  FILE_DELETE = "file:delete",
  FILE_LIST = "file:list",

  // ==================== REPORT PERMISSIONS ====================
  REPORT_CREATE = "report:create",
  REPORT_READ = "report:read",
  REPORT_EXPORT = "report:export",
  REPORT_DELETE = "report:delete",

  // ==================== NOTIFICATION PERMISSIONS ====================
  NOTIFICATION_SEND = "notification:send",
  NOTIFICATION_READ = "notification:read",
  NOTIFICATION_DELETE = "notification:delete",

  // ==================== API PERMISSIONS ====================
  API_ACCESS = "api:access",
  API_RATE_LIMIT_BYPASS = "api:rate_limit_bypass",
}

export enum RoleName {
  SUPER_ADMIN = "super_admin",
  ADMIN = "admin",
  MODERATOR = "moderator",
  USER = "user",
  GUEST = "guest",
}

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [RoleName.SUPER_ADMIN]: Object.values(Permission),

  [RoleName.ADMIN]: [
    // User management
    Permission.USER_CREATE,
    Permission.USER_READ,
    Permission.USER_UPDATE,
    Permission.USER_LIST,
    Permission.USER_ASSIGN_ROLE,
    Permission.USER_ACTIVATE,
    Permission.USER_DEACTIVATE,

    // Role management (read only)
    Permission.ROLE_READ,
    Permission.ROLE_LIST,

    // Admin access
    Permission.ADMIN_ACCESS,
    Permission.ADMIN_DASHBOARD,
    Permission.ADMIN_LOGS,

    // Content management
    Permission.CONTENT_CREATE,
    Permission.CONTENT_READ,
    Permission.CONTENT_UPDATE,
    Permission.CONTENT_DELETE,
    Permission.CONTENT_LIST,
    Permission.CONTENT_PUBLISH,
    Permission.CONTENT_UNPUBLISH,
    Permission.CONTENT_MODERATE,

    // Comments
    Permission.COMMENT_CREATE,
    Permission.COMMENT_READ,
    Permission.COMMENT_UPDATE,
    Permission.COMMENT_DELETE,
    Permission.COMMENT_MODERATE,

    // Files
    Permission.FILE_UPLOAD,
    Permission.FILE_DOWNLOAD,
    Permission.FILE_DELETE,
    Permission.FILE_LIST,

    // Reports
    Permission.REPORT_CREATE,
    Permission.REPORT_READ,
    Permission.REPORT_EXPORT,
    Permission.REPORT_DELETE,

    // Notifications
    Permission.NOTIFICATION_SEND,
    Permission.NOTIFICATION_READ,
    Permission.NOTIFICATION_DELETE,

    // API
    Permission.API_ACCESS,
  ],

  [RoleName.MODERATOR]: [
    // Limited user management
    Permission.USER_READ,
    Permission.USER_LIST,

    // Content moderation
    Permission.CONTENT_READ,
    Permission.CONTENT_UPDATE,
    Permission.CONTENT_DELETE,
    Permission.CONTENT_LIST,
    Permission.CONTENT_MODERATE,

    // Comment moderation
    Permission.COMMENT_READ,
    Permission.COMMENT_UPDATE,
    Permission.COMMENT_DELETE,
    Permission.COMMENT_MODERATE,

    // Files (limited)
    Permission.FILE_UPLOAD,
    Permission.FILE_DOWNLOAD,
    Permission.FILE_LIST,

    // Reports (read only)
    Permission.REPORT_READ,

    // Notifications
    Permission.NOTIFICATION_READ,

    // API
    Permission.API_ACCESS,
  ],

  [RoleName.USER]: [
    // Basic user permissions
    Permission.USER_READ,

    // Content (own content)
    Permission.CONTENT_CREATE,
    Permission.CONTENT_READ,
    Permission.CONTENT_UPDATE, // Only own content (enforced in business logic)
    Permission.CONTENT_LIST,

    // Comments
    Permission.COMMENT_CREATE,
    Permission.COMMENT_READ,
    Permission.COMMENT_UPDATE, // Only own comments (enforced in business logic)
    Permission.COMMENT_DELETE, // Only own comments (enforced in business logic)

    // Files (limited)
    Permission.FILE_UPLOAD,
    Permission.FILE_DOWNLOAD,
    Permission.FILE_LIST,

    // Notifications
    Permission.NOTIFICATION_READ,

    // API
    Permission.API_ACCESS,
  ],

  [RoleName.GUEST]: [
    // Very limited permissions
    Permission.CONTENT_READ,
    Permission.COMMENT_READ,
    Permission.FILE_DOWNLOAD,
  ],
};

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  // Users
  [Permission.USER_CREATE]: "Create new users",
  [Permission.USER_READ]: "View user information",
  [Permission.USER_UPDATE]: "Update user information",
  [Permission.USER_DELETE]: "Delete users",
  [Permission.USER_LIST]: "View list of all users",
  [Permission.USER_ASSIGN_ROLE]: "Assign roles to users",
  [Permission.USER_REMOVE_ROLE]: "Remove roles from users",
  [Permission.USER_ACTIVATE]: "Activate user accounts",
  [Permission.USER_DEACTIVATE]: "Deactivate user accounts",

  // Roles
  [Permission.ROLE_CREATE]: "Create new roles",
  [Permission.ROLE_READ]: "View role information",
  [Permission.ROLE_UPDATE]: "Update role information",
  [Permission.ROLE_DELETE]: "Delete roles",
  [Permission.ROLE_LIST]: "View list of all roles",
  [Permission.ROLE_ASSIGN_PERMISSION]: "Assign permissions to roles",
  [Permission.ROLE_REMOVE_PERMISSION]: "Remove permissions from roles",

  // Admin
  [Permission.ADMIN_ACCESS]: "Access admin panel",
  [Permission.ADMIN_SETTINGS]: "Manage system settings",
  [Permission.ADMIN_LOGS]: "View system logs",
  [Permission.ADMIN_SYSTEM]: "Manage system operations",
  [Permission.ADMIN_DASHBOARD]: "View admin dashboard",

  // Content
  [Permission.CONTENT_CREATE]: "Create content",
  [Permission.CONTENT_READ]: "View content",
  [Permission.CONTENT_UPDATE]: "Update content",
  [Permission.CONTENT_DELETE]: "Delete content",
  [Permission.CONTENT_LIST]: "View content list",
  [Permission.CONTENT_PUBLISH]: "Publish content",
  [Permission.CONTENT_UNPUBLISH]: "Unpublish content",
  [Permission.CONTENT_MODERATE]: "Moderate content",

  // Comments
  [Permission.COMMENT_CREATE]: "Create comments",
  [Permission.COMMENT_READ]: "Read comments",
  [Permission.COMMENT_UPDATE]: "Update comments",
  [Permission.COMMENT_DELETE]: "Delete comments",
  [Permission.COMMENT_MODERATE]: "Moderate comments",

  // Files
  [Permission.FILE_UPLOAD]: "Upload files",
  [Permission.FILE_DOWNLOAD]: "Download files",
  [Permission.FILE_DELETE]: "Delete files",
  [Permission.FILE_LIST]: "View file list",

  // Reports
  [Permission.REPORT_CREATE]: "Create reports",
  [Permission.REPORT_READ]: "View reports",
  [Permission.REPORT_EXPORT]: "Export reports",
  [Permission.REPORT_DELETE]: "Delete reports",

  // Notifications
  [Permission.NOTIFICATION_SEND]: "Send notifications",
  [Permission.NOTIFICATION_READ]: "Read notifications",
  [Permission.NOTIFICATION_DELETE]: "Delete notifications",

  // API
  [Permission.API_ACCESS]: "Access API",
  [Permission.API_RATE_LIMIT_BYPASS]: "Bypass API rate limits",
};

export const PERMISSION_GROUPS = {
  user: {
    label: "User Management",
    permissions: [
      Permission.USER_CREATE,
      Permission.USER_READ,
      Permission.USER_UPDATE,
      Permission.USER_DELETE,
      Permission.USER_LIST,
      Permission.USER_ASSIGN_ROLE,
      Permission.USER_REMOVE_ROLE,
      Permission.USER_ACTIVATE,
      Permission.USER_DEACTIVATE,
    ],
  },
  role: {
    label: "Role Management",
    permissions: [
      Permission.ROLE_CREATE,
      Permission.ROLE_READ,
      Permission.ROLE_UPDATE,
      Permission.ROLE_DELETE,
      Permission.ROLE_LIST,
      Permission.ROLE_ASSIGN_PERMISSION,
      Permission.ROLE_REMOVE_PERMISSION,
    ],
  },
  admin: {
    label: "Administration",
    permissions: [
      Permission.ADMIN_ACCESS,
      Permission.ADMIN_SETTINGS,
      Permission.ADMIN_LOGS,
      Permission.ADMIN_SYSTEM,
      Permission.ADMIN_DASHBOARD,
    ],
  },
  content: {
    label: "Content Management",
    permissions: [
      Permission.CONTENT_CREATE,
      Permission.CONTENT_READ,
      Permission.CONTENT_UPDATE,
      Permission.CONTENT_DELETE,
      Permission.CONTENT_LIST,
      Permission.CONTENT_PUBLISH,
      Permission.CONTENT_UNPUBLISH,
      Permission.CONTENT_MODERATE,
    ],
  },
  comment: {
    label: "Comment Management",
    permissions: [
      Permission.COMMENT_CREATE,
      Permission.COMMENT_READ,
      Permission.COMMENT_UPDATE,
      Permission.COMMENT_DELETE,
      Permission.COMMENT_MODERATE,
    ],
  },
  file: {
    label: "File Management",
    permissions: [
      Permission.FILE_UPLOAD,
      Permission.FILE_DOWNLOAD,
      Permission.FILE_DELETE,
      Permission.FILE_LIST,
    ],
  },
  report: {
    label: "Reports",
    permissions: [
      Permission.REPORT_CREATE,
      Permission.REPORT_READ,
      Permission.REPORT_EXPORT,
      Permission.REPORT_DELETE,
    ],
  },
  notification: {
    label: "Notifications",
    permissions: [
      Permission.NOTIFICATION_SEND,
      Permission.NOTIFICATION_READ,
      Permission.NOTIFICATION_DELETE,
    ],
  },
  api: {
    label: "API Access",
    permissions: [Permission.API_ACCESS, Permission.API_RATE_LIMIT_BYPASS],
  },
};

export function getRolePermissions(roleName: RoleName): Permission[] {
  return DEFAULT_ROLE_PERMISSIONS[roleName] || [];
}

export function isSystemRole(roleName: string): boolean {
  return Object.values(RoleName).includes(roleName as RoleName);
}

export function getPermissionDescription(permission: Permission): string {
  return PERMISSION_DESCRIPTIONS[permission] || "No description available";
}
