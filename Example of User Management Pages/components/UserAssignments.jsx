import { UserCheck, Calendar, MapPin, ShieldCheck, ShieldX, Clock } from 'lucide-react';
import { USERS, DOMAIN_COLORS, ROLES } from '../data/mockData';
import type { UserStatus } from '../types';

const STATUS_CONFIG: Record<UserStatus, { label: string; classes: string; dot: string }> = {
    ACTIVE: { label: 'Active', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
    DISABLED: { label: 'Disabled', classes: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-400' },
    INVITED: { label: 'Invited', classes: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-400' },
};

const SCOPE_LEVEL_ICON: Record<string, string> = {
    Tenant: 'T',
    Group: 'G',
    Country: 'C',
    'Legal Entity': 'L',
    'Operating Unit': 'O',
};

function getInitials(name: string) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

export default function UserAssignments() {
    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 bg-white sticky top-0 z-10">
                <h2 className="text-sm font-semibold text-gray-900">User Role Assignments</h2>
                <p className="text-xs text-gray-500 mt-0.5">Current role assignments with scope, effect, and temporal validity</p>
            </div>

            <div className="p-6 space-y-4">
                {USERS.map(user => {
                    const status = STATUS_CONFIG[user.status];
                    const isTemporary = user.roles.some(r => r.effectiveTo);
                    return (
                        <div key={user.id} className="rounded-xl border border-gray-100 bg-white overflow-hidden hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center flex-shrink-0">
                                        <span className="text-xs font-bold text-white">{getInitials(user.name)}</span>
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-semibold text-gray-900">{user.name}</p>
                                            {isTemporary && (
                                                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5">
                                                    <Clock className="w-3 h-3" />Temporal
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-400">{user.email}</p>
                                    </div>
                                </div>
                                <span className={`flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1 ${status.classes}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                                    {status.label}
                                </span>
                            </div>
                            <div className="px-5 py-3 space-y-2">
                                {user.roles.map((assignment, ai) => {
                                    const role = ROLES.find(r => r.id === assignment.roleId);
                                    const domainColor = role ? (DOMAIN_COLORS[role.domain] || DOMAIN_COLORS.System) : DOMAIN_COLORS.System;
                                    const scopeInitial = SCOPE_LEVEL_ICON[assignment.scope] || '?';
                                    return (
                                        <div key={ai} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold border flex-shrink-0 ${domainColor.bg} ${domainColor.text} ${domainColor.border}`}>
                                                {scopeInitial}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-semibold text-gray-800 truncate">{assignment.roleName}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <div className="flex items-center gap-1 text-xs text-gray-400">
                                                        <MapPin className="w-3 h-3" />
                                                        <span>{assignment.scope}: </span>
                                                        <span className="text-gray-600 font-medium">{assignment.scopeTarget}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                                <div className="flex items-center gap-1">
                                                    {assignment.effect === 'ALLOW' ? (
                                                        <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                                                            <ShieldCheck className="w-3 h-3" /> ALLOW
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                                                            <ShieldX className="w-3 h-3" /> DENY
                                                        </span>
                                                    )}
                                                </div>
                                                {(assignment.effectiveFrom || assignment.effectiveTo) && (
                                                    <div className="flex items-center gap-1 text-xs text-gray-400">
                                                        <Calendar className="w-3 h-3" />
                                                        <span>
                                                            {assignment.effectiveFrom}
                                                            {assignment.effectiveTo ? ` → ${assignment.effectiveTo}` : ''}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {user.roles.length === 0 && (
                                    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                                        <UserCheck className="w-4 h-4" />
                                        <span>No active role assignments</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
