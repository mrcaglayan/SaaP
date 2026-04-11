import { PermissionModuleEditor } from "./RolesPermissionsPanels.jsx";

/**
 * Renders the permissions tab by reusing the grouped module editor on the
 * dedicated role detail page.
 */
export default function RolePermissionsTab(props) {
  return <PermissionModuleEditor {...props} />;
}
