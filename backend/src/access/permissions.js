export const PERMISSIONS = [
  {
    "key": "customers.read",
    "label": "View",
    "group": "Customers",
    "readOnly": true
  },
  {
    "key": "customers.create",
    "label": "Create",
    "group": "Customers",
    "readOnly": false
  },
  {
    "key": "customers.export",
    "label": "Export",
    "group": "Customers",
    "readOnly": true
  },
  {
    "key": "orders.read",
    "label": "View",
    "group": "Sales orders",
    "readOnly": true
  },
  {
    "key": "orders.create",
    "label": "Create",
    "group": "Sales orders",
    "readOnly": false
  },
  {
    "key": "orders.update",
    "label": "Update",
    "group": "Sales orders",
    "readOnly": false
  },
  {
    "key": "orders.export",
    "label": "Export",
    "group": "Sales orders",
    "readOnly": true
  },
  {
    "key": "sourcing.read",
    "label": "View",
    "group": "Sourcing",
    "readOnly": true
  },
  {
    "key": "sourcing.create",
    "label": "Create",
    "group": "Sourcing",
    "readOnly": false
  },
  {
    "key": "sourcing.update",
    "label": "Update",
    "group": "Sourcing",
    "readOnly": false
  },
  {
    "key": "sourcing.export",
    "label": "Export",
    "group": "Sourcing",
    "readOnly": true
  },
  {
    "key": "dispatches.read",
    "label": "View",
    "group": "Dispatch & delivery",
    "readOnly": true
  },
  {
    "key": "dispatches.create",
    "label": "Create",
    "group": "Dispatch & delivery",
    "readOnly": false
  },
  {
    "key": "dispatches.update",
    "label": "Update",
    "group": "Dispatch & delivery",
    "readOnly": false
  },
  {
    "key": "dispatches.export",
    "label": "Export",
    "group": "Dispatch & delivery",
    "readOnly": true
  },
  {
    "key": "invoices.read",
    "label": "View",
    "group": "Invoices",
    "readOnly": true
  },
  {
    "key": "invoices.create",
    "label": "Create",
    "group": "Invoices",
    "readOnly": false
  },
  {
    "key": "invoices.export",
    "label": "Export",
    "group": "Invoices",
    "readOnly": true
  },
  {
    "key": "receipts.read",
    "label": "View",
    "group": "Payment receipts",
    "readOnly": true
  },
  {
    "key": "receipts.create",
    "label": "Create",
    "group": "Payment receipts",
    "readOnly": false
  },
  {
    "key": "receipts.export",
    "label": "Export",
    "group": "Payment receipts",
    "readOnly": true
  },
  {
    "key": "tasks.read",
    "label": "View",
    "group": "Follow-ups",
    "readOnly": true
  },
  {
    "key": "tasks.create",
    "label": "Create",
    "group": "Follow-ups",
    "readOnly": false
  },
  {
    "key": "tasks.update",
    "label": "Update",
    "group": "Follow-ups",
    "readOnly": false
  },
  {
    "key": "tasks.export",
    "label": "Export",
    "group": "Follow-ups",
    "readOnly": true
  },
  {
    "key": "audit.operations.read",
    "label": "View sales activity",
    "group": "Activity",
    "readOnly": true
  },
  {
    "key": "audit.read",
    "label": "View activity",
    "group": "Activity",
    "readOnly": true
  },
  {
    "key": "access.users.read",
    "label": "View users & roles",
    "group": "Admin access",
    "readOnly": true
  },
  {
    "key": "access.manage",
    "label": "Manage access",
    "group": "Admin access",
    "readOnly": false
  }
];
export const PERMISSION_KEYS = new Set(PERMISSIONS.map(p=>p.key));
export const REGISTERS = ["customers","orders","sourcing","dispatches","invoices","receipts","tasks"];
export const SYSTEM_ROLES = [
  {
    "key": "admin",
    "name": "Administrator",
    "permissions": [
      "customers.read",
      "customers.create",
      "customers.export",
      "orders.read",
      "orders.create",
      "orders.update",
      "orders.export",
      "sourcing.read",
      "sourcing.create",
      "sourcing.update",
      "sourcing.export",
      "dispatches.read",
      "dispatches.create",
      "dispatches.update",
      "dispatches.export",
      "invoices.read",
      "invoices.create",
      "invoices.export",
      "receipts.read",
      "receipts.create",
      "receipts.export",
      "tasks.read",
      "tasks.create",
      "tasks.update",
      "tasks.export",
      "audit.read",
      "access.users.read",
      "access.manage"
    ],
    "id": "00000000-0000-4000-8000-000000000001"
  },
  {
    "key": "member",
    "name": "Member",
    "permissions": [
      "customers.read",
      "customers.create",
      "orders.read",
      "orders.create",
      "orders.update",
      "sourcing.read",
      "sourcing.create",
      "sourcing.update",
      "tasks.read",
      "tasks.update",
      "customers.export",
      "orders.export",
      "sourcing.export",
      "audit.operations.read"
    ],
    "id": "00000000-0000-4000-8000-000000000006"
  },
  {
    "key": "viewer",
    "name": "Read only",
    "permissions": [
      "customers.read",
      "orders.read",
      "sourcing.read",
      "dispatches.read",
      "invoices.read",
      "receipts.read",
      "tasks.read"
    ],
    "id": "00000000-0000-4000-8000-000000000005"
  }
];
export function can(actor,key){return PERMISSION_KEYS.has(key) && (actor.is_super_admin===true || actor.permissions?.includes(key)===true);}
export function requirePermissions(actor,...keys){for(const key of keys)if(!can(actor,key))throw new HttpError(403,'Missing permission: '+key);}
import {HttpError} from '../domain.js';

