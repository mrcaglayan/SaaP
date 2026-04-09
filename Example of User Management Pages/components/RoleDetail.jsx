import { X, Shield, Users, Clock, AlertTriangle, CheckCircle, Lock, ChevronRight } from 'lucide-react';
import type { Role } from '../types';
import { PERMISSIONS, DOMAIN_COLORS, SOD_RULES, ROLES } from '../data/mockData';

interface Props {
    role: Role;
    onClose: () => void;
}

const SCOPE_ORDER = ['Tenant', 'Group', 'Country', 'Legal Entity', 'Operating Unit'];

export default function RoleDetail({ role, onClose }: Props) {
    const domainColor = DOMAIN_COLORS[role.domain] || DOMAIN_COLORS.System;
    const rolePermissions = PERMISSIONS.filter(p => role.permissions.includes(p.code));
    const permissionsByModule = rolePermissions.reduce < Record < string, typeof PERMISSIONS >> ((acc, p) => {
        if (!acc[p.module]) acc[p.module] = [];
        acc[p.module].push(p);
        return acc;
    }, {});

    const sodConflicts = SOD_RULES.filter(r => r.roleA === role.name || r.roleB === role.name);
    const conflictingRoles = ROLES.filter(r => role.sodConflicts?.includes(r.id));

    return (
        <div className="flex flex-col h-full bg-white">
            <div className={`px-6 py-5 border-b border-gray-100 ${domainColor.bg}`}>
                <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                        <div className={`mt-0.5 p-2 rounded-lg border ${domainColor.border} bg-white`}>
                            <Shield className={`w-5 h-5 ${domainColor.text}`} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-semibold text-gray-900">{role.label}</h2>
                                {role.isSystem && (
                                    <span className="flex items-center gap-1 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">
                                        <Lock className="w-3 h-3" /> System
                                    </span>
                                )}
                            </div>
                            <p className="text-sm text-gray-500 font-mono mt-0.5">{role.name}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all text-gray-400 hover:text-gray-600"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <p className="mt-3 text-sm text-gray-600 leading-relaxed">{role.description}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1">
                        <Users className="w-3.5 h-3.5 text-gray-400" />
                        <span>{role.userCount} users assigned</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1">
                        <CheckCircle className="w-3.5 h-3.5 text-gray-400" />
                        <span>{role.permissions.length} permissions</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-3 py-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span>Updated {role.updatedAt}</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="p-6 space-y-6">
                    <div>
                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Scope Levels</h3>
                        <div className="flex flex-wrap gap-1.5">
                            {SCOPE_ORDER.map(scope => {
                                const active = role.scopes.includes(scope as never);
                                return (
                                    <span
                                        key={scope}
                                        className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-all ${active
                                                ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                : 'bg-gray-50 text-gray-300 border-gray-100'
                                            }`}
                                    >
                                        {scope}
                                    </span>
                                );
                            })}
                        </div>
                        <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                            <ChevronRight className="w-3 h-3" />
                            <span>Tenant → Group → Country → Legal Entity → Operating Unit</span>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                            Permissions ({role.permissions.length})
                        </h3>
                        <div className="space-y-3">
                            {Object.entries(permissionsByModule).map(([module, perms]) => (
                                <div key={module} className="rounded-xl border border-gray-100 overflow-hidden">
                                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{module}</span>
                                    </div>
                                    <div className="divide-y divide-gray-50">
                                        {perms.map(perm => (
                                            <div key={perm.code} className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors">
                                                <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-800">{perm.label}</p>
                                                    <p className="text-xs text-gray-400 mt-0.5">{perm.description}</p>
                                                    {perm.requiresRead && (
                                                        <span className="inline-block mt-1 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
                                                            Requires READ
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {sodConflicts.length > 0 && (
                        <div>
                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                                SoD Constraints
                            </h3>
                            <div className="space-y-2">
                                {sodConflicts.map(rule => (
                                    <div
                                        key={rule.id}
                                        className={`rounded-xl border p-3 ${rule.enforcement === 'BLOCK'
                                                ? 'border-red-100 bg-red-50'
                                                : 'border-amber-100 bg-amber-50'
                                            }`}
                                    >
                                        <div className="flex items-start gap-2">
                                            <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${rule.enforcement === 'BLOCK' ? 'text-red-500' : 'text-amber-500'}`} />
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-semibold text-gray-800">{rule.name}</p>
                                                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${rule.enforcement === 'BLOCK'
                                                            ? 'bg-red-100 text-red-700'
                                                            : 'bg-amber-100 text-amber-700'
                                                        }`}>
                                                        {rule.enforcement}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{rule.description}</p>
                                                <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                                                    <code className="bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono">{rule.permissionA}</code>
                                                    <span>conflicts with</span>
                                                    <code className="bg-white border border-gray-200 rounded px-1.5 py-0.5 font-mono">{rule.permissionB}</code>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {conflictingRoles.length > 0 && (
                        <div>
                            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                                Cannot Be Combined With
                            </h3>
                            <div className="space-y-2">
                                {conflictingRoles.map(cr => {
                                    const crColor = DOMAIN_COLORS[cr.domain] || DOMAIN_COLORS.System;
                                    return (
                                        <div key={cr.id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-2 h-2 rounded-full ${crColor.text.replace('text-', 'bg-')}`} />
                                                <span className="text-sm font-medium text-gray-700">{cr.label}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full border ${crColor.bg} ${crColor.text} ${crColor.border}`}>
                                                    {cr.domain}
                                                </span>
                                            </div>
                                            <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded">BLOCK</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
