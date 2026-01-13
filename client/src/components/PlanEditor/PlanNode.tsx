import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import type { PlanStep } from '@claude-code-web/shared';

interface PlanNodeData {
  step: PlanStep;
  index: number;
}

const statusColors: Record<string, { bg: string; border: string; text: string }> = {
  pending: { bg: 'bg-gray-700', border: 'border-gray-600', text: 'text-gray-300' },
  in_progress: { bg: 'bg-blue-900/50', border: 'border-blue-500', text: 'text-blue-200' },
  completed: { bg: 'bg-green-900/50', border: 'border-green-500', text: 'text-green-200' },
  skipped: { bg: 'bg-yellow-900/50', border: 'border-yellow-500', text: 'text-yellow-200' },
  failed: { bg: 'bg-red-900/50', border: 'border-red-500', text: 'text-red-200' },
};

function PlanNode({ data }: NodeProps<PlanNodeData>) {
  const { step, index } = data;
  const colors = statusColors[step.status] || statusColors.pending;

  return (
    <div
      className={`rounded-lg border-2 p-4 min-w-[200px] max-w-[280px] ${colors.bg} ${colors.border}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${colors.bg} ${colors.text}`}>
          Step {index + 1}
        </span>
        {step.status === 'in_progress' && (
          <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        )}
        {step.status === 'completed' && (
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>

      <h3 className={`font-medium ${colors.text}`}>{step.title}</h3>

      {step.description && (
        <p className="text-gray-400 text-sm mt-2 line-clamp-3">{step.description}</p>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}

export default memo(PlanNode);
