import { useState, useMemo } from 'react';
import {
    Shield, Search, Plus, Users, Lock, AlertTriangle, ChevronRight,
    LayoutGrid, Table2, GitMerge, UserCheck, Filter, CheckCircle, RefreshCw
} from 'lucide-react';
import type { Role, ViewTab, RoleDomain } from '../types';
import { ROLES, DOMAIN_COLORS } from '../data/mockData';
import RoleDetail from './RoleDetail';
import PermissionMatrix from './PermissionMatrix';
import SoDRules from './SoDRules';
import UserAssignments from './UserAssignments';

const DOMAINS: RoleDomain[] = ['Security', 'Finance', 'Payroll', 'Close', 'Audit', 'AR/AP', 'Inventory', 'Consolidation'];

const TABS: { id: ViewTab; label: string; icon: React.ReactNode }[] = [
    { id: 'roles', label: 'Roles', icon: <LayoutGrid className="w-4 h-4" /> },
    { id: 'matrix', label: 'Permission Matrix', icon: <Table2 className="w-4 h-4" /> },
    { id: 'sod', label: 'SoD Rules', icon: <GitMerge className="w-4 h-4" /> },
    { id: 'assignments', label: 'Assignments', icon: <UserCheck className="w-4 h-4" /> },
];

function RoleCard({ role, onClick, isSelected }: { role: Role; onClick: () => void; isSelected: boolean }) {
    const domainColor = DOMAIN_COLORS[role.domain] || DOMAIN_COLORS.System;
    const hasSoD = (role.sodConflicts?.length ?? 0) > 0;

    return (
        <button
            onClick={onClick}
            className={`w-full text-left p-4 rounded-xl border transition-all group hover:shadow-md ${isSelected
                    ? 'border-blue-300 bg-blue-50/60 shadow-sm ring-1 ring-blue-200'
                    : 'border-gray-100 bg-white hover:border-gray-200'
                }`}
        >
            <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-lg border ${domainColor.bg} ${domainColor.border}`}>
                        <Shield className={`w-4 h-4 ${domainColor.text}`} />
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-gray-900 leading-tight">{role.label}</p>
                            {role.isSystem && <Lock className="w-3 h-3 text-gray-300" />}
                        </div>
                        <p className="text-xs text-gray-400 font-mono">{role.name}</p>
                    </div>
                </div>
                <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${domainColor.bg} ${domainColor.text} ${domainColor.border}`}>
                    {role.domain}
                </span>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-2">{role.description}</p>

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {role.userCount}
                    </span>
                    <span className="flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        {role.permissions.length} perms
                    </span>
                    {hasSoD && (
                        <span className="flex items-center gap-1 text-amber-500">
                            <AlertTriangle className="w-3 h-3" />
                            SoD
                        </span>
                    )}
                </div>
                <ChevronRight className={`w-4 h-4 transition-all ${isSelected ? 'text-blue-500 translate-x-0.5' : 'text-gray-300 group-hover:text-gray-400'}`} />
            </div>
        </button>
    );
}

export default function RolesPage() {
    const [activeTab, setActiveTab] = useState < ViewTab > ('roles');
    const [selectedRole, setSelectedRole] = useState < Role | null > (null);
    const [search, setSearch] = useState('');
    const [domainFilter, setDomainFilter] = useState < RoleDomain | 'All' > ('All');
    const [systemFilter, setSystemFilter] = useState < 'all' | 'system' | 'custom' > ('all');

    const filteredRoles = useMemo(() => {
        return ROLES.filter(r => {
            const matchSearch = !search || r.label.toLowerCase().includes(search.toLowerCase()) || r.name.toLowerCase().includes(search.toLowerCase()) || r.description.toLowerCase().includes(search.toLowerCase());
            const matchDomain = domainFilter === 'All' || r.domain === domainFilter;
            const matchSystem = systemFilter === 'all' || (systemFilter === 'system' && r.isSystem) || (systemFilter === 'custom' && !r.isSystem);
            return matchSearch && matchDomain && matchSystem;
        });
    }, [search, domainFilter, systemFilter]);

    const stats = useMemo(() => ({
        total: ROLES.length,
        system: ROLES.filter(r => r.isSystem).length,
        custom: ROLES.filter(r => !r.isSystem).length,
        withSoD: ROLES.filter(r => (r.sodConflicts?.length ?? 0) > 0).length,
        totalUsers: ROLES.reduce((sum, r) => sum + r.userCount, 0),
    }), []);

    return (
        <div className="flex flex-col h-screen bg-gray-50 font-sans">
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-slate-900">
                            <Shield className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900 leading-tight">Role & Permission Management</h1>
                            <p className="text-xs text-gray-400">RBAC · SoD Enforcement · Scope-Based Access Control</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors">
                            <RefreshCw className="w-3.5 h-3.5" />
                            Sync
                        </button>
                        <button className="flex items-center gap-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg px-3 py-2 hover:bg-slate-800 transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                            New Role
                        </button>
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-5 gap-3">
                    {[
                        { label: 'Total Roles', value: stats.total, color: 'text-gray-900' },
                        { label: 'System Roles', value: stats.system, color: 'text-slate-700' },
                        { label: 'Custom Roles', value: stats.custom, color: 'text-blue-700' },
                        { label: 'SoD Constrained', value: stats.withSoD, color: 'text-amber-700' },
                        { label: 'Total Assignments', value: stats.totalUsers, color: 'text-emerald-700' },
                    ].map(s => (
                        <div key={s.label} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                        </div>
                    ))}
                </div>
            </header>

            <div className="bg-white border-b border-gray-200 px-6 flex-shrink-0">
                <div className="flex items-center gap-1">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => { setActiveTab(tab.id); setSelectedRole(null); }}
                            className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-all ${activeTab === tab.id
                                    ? 'border-slate-900 text-slate-900'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {activeTab === 'roles' && (
                    <>
                        <div className="flex flex-col w-64 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
                            <div className="p-4 border-b border-gray-100">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5">Filter by Domain</p>
                                <div className="space-y-1">
                                    <button
                                        onClick={() => setDomainFilter('All')}
                                        className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${domainFilter === 'All' ? 'bg-slate-900 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        <span>All Domains</span>
                                        <span className={`text-xs rounded-full px-1.5 ${domainFilter === 'All' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                            {ROLES.length}
                                        </span>
                                    </button>
                                    {DOMAINS.map(domain => {
                                        const count = ROLES.filter(r => r.domain === domain).length;
                                        if (count === 0) return null;
                                        const color = DOMAIN_COLORS[domain];
                                        return (
                                            <button
                                                key={domain}
                                                onClick={() => setDomainFilter(domain)}
                                                className={`w-full text-left flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${domainFilter === domain
                                                        ? `${color.bg} ${color.text} font-semibold border ${color.border}`
                                                        : 'text-gray-600 hover:bg-gray-50'
                                                    }`}
                                            >
                                                <span>{domain}</span>
                                                <span className={`text-xs rounded-full px-1.5 ${domainFilter === domain ? `${color.bg} ${color.text}` : 'bg-gray-100 text-gray-500'}`}>
                                                    {count}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="p-4">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5">Role Type</p>
                                <div className="space-y-1">
                                    {([['all', 'All Roles'], ['system', 'System Roles'], ['custom', 'Custom Roles']] as const).map(([val, label]) => (
                                        <button
                                            key={val}
                                            onClick={() => setSystemFilter(val)}
                                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${systemFilter === val ? 'bg-slate-900 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'
                                                }`}
                                        >
                                            {val === 'system' && <Lock className="w-3.5 h-3.5" />}
                                            {val === 'custom' && <Plus className="w-3.5 h-3.5" />}
                                            {val === 'all' && <Filter className="w-3.5 h-3.5" />}
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-1 overflow-hidden">
                            <div className={`flex flex-col transition-all duration-300 ${selectedRole ? 'w-[55%]' : 'w-full'} overflow-hidden`}>
                                <div className="px-4 py-3 border-b border-gray-100 bg-white flex items-center gap-2 flex-shrink-0">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <input
                                            type="text"
                                            placeholder="Search roles by name or description..."
                                            value={search}
                                            onChange={e => setSearch(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
                                        />
                                    </div>
                                    <span className="text-xs text-gray-400 whitespace-nowrap">{filteredRoles.length} roles</span>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4">
                                    {filteredRoles.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-16 text-center">
                                            <Shield className="w-12 h-12 text-gray-200 mb-3" />
                                            <p className="text-sm font-medium text-gray-400">No roles found</p>
                                            <p className="text-xs text-gray-300 mt-1">Try adjusting your filters</p>
                                        </div>
                                    ) : (
                                        <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
                                            {filteredRoles.map(role => (
                                                <RoleCard
                                                    key={role.id}
                                                    role={role}
                                                    isSelected={selectedRole?.id === role.id}
                                                    onClick={() => setSelectedRole(selectedRole?.id === role.id ? null : role)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {selectedRole && (
                                <div className="w-[45%] border-l border-gray-200 overflow-hidden flex-shrink-0 bg-white">
                                    <RoleDetail role={selectedRole} onClose={() => setSelectedRole(null)} />
                                </div>
                            )}
                        </div>
                    </>
                )}

                {activeTab === 'matrix' && (
                    <div className="flex-1 overflow-hidden">
                        <PermissionMatrix roles={ROLES} />
                    </div>
                )}

                {activeTab === 'sod' && (
                    <div className="flex-1 overflow-hidden">
                        <SoDRules />
                    </div>
                )}

                {activeTab === 'assignments' && (
                    <div className="flex-1 overflow-hidden">
                        <UserAssignments />
                    </div>
                )}
            </div>
        </div>
    );
}
