import { AlertTriangle, ShieldAlert, ShieldCheck, Info } from 'lucide-react';
import { SOD_RULES } from '../data/mockData';

export default function SoDRules() {
    const blocked = SOD_RULES.filter(r => r.enforcement === 'BLOCK');
    const warned = SOD_RULES.filter(r => r.enforcement === 'WARN');

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 bg-white sticky top-0 z-10">
                <h2 className="text-sm font-semibold text-gray-900">Segregation of Duties Rules</h2>
                <p className="text-xs text-gray-500 mt-0.5">Active conflict detection rules enforced across all role assignments</p>
            </div>

            <div className="p-6 space-y-6">
                <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-xl border border-gray-100 p-4 bg-white">
                        <p className="text-2xl font-bold text-gray-900">{SOD_RULES.length}</p>
                        <p className="text-xs text-gray-500 mt-1">Total SoD Rules</p>
                    </div>
                    <div className="rounded-xl border border-red-100 p-4 bg-red-50">
                        <p className="text-2xl font-bold text-red-700">{blocked.length}</p>
                        <p className="text-xs text-red-600 mt-1">BLOCK Enforced</p>
                    </div>
                    <div className="rounded-xl border border-amber-100 p-4 bg-amber-50">
                        <p className="text-2xl font-bold text-amber-700">{warned.length}</p>
                        <p className="text-xs text-amber-600 mt-1">WARN Only</p>
                    </div>
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 flex gap-3">
                    <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-blue-700 leading-relaxed">
                        <strong>BLOCK</strong> rules prevent role assignment when a conflict is detected at the system level.
                        <strong> WARN</strong> rules allow the assignment but generate an audit alert and require manager acknowledgment.
                    </p>
                </div>

                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <ShieldAlert className="w-4 h-4 text-red-500" />
                        <h3 className="text-sm font-semibold text-gray-800">BLOCK Rules</h3>
                        <span className="text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5 font-medium">{blocked.length}</span>
                    </div>
                    <div className="space-y-3">
                        {blocked.map(rule => (
                            <div key={rule.id} className="rounded-xl border border-gray-100 bg-white p-4 hover:border-red-200 hover:shadow-sm transition-all">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                            <h4 className="text-sm font-semibold text-gray-900">{rule.name}</h4>
                                            <span className="text-xs font-bold bg-red-100 text-red-700 border border-red-200 rounded px-1.5 py-0.5">BLOCK</span>
                                        </div>
                                        <p className="text-xs text-gray-500 leading-relaxed mb-3">{rule.description}</p>
                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <span className="text-gray-400">Conflict between:</span>
                                            <code className="font-mono bg-red-50 text-red-700 border border-red-200 rounded px-2 py-0.5">{rule.permissionA}</code>
                                            <span className="text-gray-300">+</span>
                                            <code className="font-mono bg-red-50 text-red-700 border border-red-200 rounded px-2 py-0.5">{rule.permissionB}</code>
                                        </div>
                                    </div>
                                </div>
                                {(rule.roleA || rule.roleB) && (
                                    <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                        <span>Commonly affects:</span>
                                        {rule.roleA && (
                                            <span className="bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5 font-medium">{rule.roleA}</span>
                                        )}
                                        {rule.roleB && rule.roleB !== rule.roleA && (
                                            <>
                                                <span className="text-gray-300">vs</span>
                                                <span className="bg-gray-100 text-gray-700 rounded-full px-2.5 py-0.5 font-medium">{rule.roleB}</span>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <ShieldCheck className="w-4 h-4 text-amber-500" />
                        <h3 className="text-sm font-semibold text-gray-800">WARN Rules</h3>
                        <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">{warned.length}</span>
                    </div>
                    <div className="space-y-3">
                        {warned.map(rule => (
                            <div key={rule.id} className="rounded-xl border border-gray-100 bg-white p-4 hover:border-amber-200 hover:shadow-sm transition-all">
                                <div className="flex items-start gap-2 mb-1.5">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-semibold text-gray-900">{rule.name}</h4>
                                            <span className="text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">WARN</span>
                                        </div>
                                        <p className="text-xs text-gray-500 leading-relaxed mt-1 mb-3">{rule.description}</p>
                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <span className="text-gray-400">Conflict between:</span>
                                            <code className="font-mono bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">{rule.permissionA}</code>
                                            <span className="text-gray-300">+</span>
                                            <code className="font-mono bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">{rule.permissionB}</code>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
