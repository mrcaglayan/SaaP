import { CheckCircle, MinusCircle } from 'lucide-react';
import type { Role } from '../types';
import { PERMISSIONS, MODULES, DOMAIN_COLORS } from '../data/mockData';

interface Props {
    roles: Role[];
}

export default function PermissionMatrix({ roles }: Props) {
    const selectedModules = MODULES;

    return (
        <div className="flex flex-col h-full">
            <div className="px-6 py-4 border-b border-gray-100 bg-white">
                <h2 className="text-sm font-semibold text-gray-900">Permission Matrix</h2>
                <p className="text-xs text-gray-500 mt-0.5">Cross-reference roles and permissions across all modules</p>
            </div>
            <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="sticky top-0 z-10">
                            <th className="sticky left-0 z-20 bg-gray-50 border-b border-r border-gray-200 px-4 py-3 text-left min-w-[220px]">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</span>
                            </th>
                            {selectedModules.map(mod => {
                                const modPerms = PERMISSIONS.filter(p => p.module === mod);
                                if (modPerms.length === 0) return null;
                                return (
                                    <th
                                        key={mod}
                                        colSpan={modPerms.length}
                                        className="border-b border-r border-gray-200 bg-gray-50 px-2 py-2 text-center"
                                    >
                                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{mod}</span>
                                    </th>
                                );
                            })}
                        </tr>
                        <tr className="sticky top-[41px] z-10">
                            <th className="sticky left-0 z-20 bg-white border-b border-r border-gray-200 px-4 py-2" />
                            {selectedModules.flatMap(mod => {
                                const modPerms = PERMISSIONS.filter(p => p.module === mod);
                                return modPerms.map((perm, i) => (
                                    <th
                                        key={perm.code}
                                        className={`border-b border-gray-200 bg-white px-2 py-2 min-w-[90px] ${i === modPerms.length - 1 ? 'border-r' : ''}`}
                                    >
                                        <div className="flex flex-col items-center gap-0.5">
                                            <span className="text-[10px] font-mono text-gray-400 leading-tight text-center">{perm.code.split('_').slice(1).join('_')}</span>
                                            <span className="text-[10px] text-gray-500 text-center leading-tight max-w-[80px]">{perm.label}</span>
                                        </div>
                                    </th>
                                ));
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {roles.map((role, ri) => {
                            const domainColor = DOMAIN_COLORS[role.domain] || DOMAIN_COLORS.System;
                            return (
                                <tr key={role.id} className={`group transition-colors ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30`}>
                                    <td className={`sticky left-0 z-10 border-r border-b border-gray-100 px-4 py-2 ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} group-hover:bg-blue-50/30`}>
                                        <div className="flex items-center gap-2">
                                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${domainColor.bg} border ${domainColor.border}`}
                                                style={{ backgroundColor: undefined }}
                                            >
                                                <div className={`w-full h-full rounded-full ${domainColor.text.replace('text-', 'bg-').replace('-700', '-400')}`} />
                                            </div>
                                            <div>
                                                <p className="text-xs font-semibold text-gray-800 whitespace-nowrap">{role.label}</p>
                                                <span className={`text-[10px] font-medium ${domainColor.text}`}>{role.domain}</span>
                                            </div>
                                        </div>
                                    </td>
                                    {selectedModules.flatMap(mod => {
                                        const modPerms = PERMISSIONS.filter(p => p.module === mod);
                                        return modPerms.map((perm, i) => {
                                            const has = role.permissions.includes(perm.code);
                                            return (
                                                <td
                                                    key={perm.code}
                                                    className={`border-b border-gray-100 text-center py-2 ${i === modPerms.length - 1 ? 'border-r border-gray-200' : ''}`}
                                                >
                                                    {has ? (
                                                        <div className="flex justify-center">
                                                            <CheckCircle className="w-4 h-4 text-emerald-500" />
                                                        </div>
                                                    ) : (
                                                        <div className="flex justify-center">
                                                            <MinusCircle className="w-4 h-4 text-gray-200" />
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        });
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-6 text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Permission granted</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <MinusCircle className="w-3.5 h-3.5 text-gray-300" />
                    <span>Not granted</span>
                </div>
                <span className="ml-auto">{roles.length} roles × {PERMISSIONS.length} permissions</span>
            </div>
        </div>
    );
}
