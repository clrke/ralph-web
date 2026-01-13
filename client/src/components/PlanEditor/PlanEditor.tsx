import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  ConnectionLineType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Plan, PlanStep } from '@claude-code-web/shared';
import PlanNode from './PlanNode';

interface PlanEditorProps {
  plan: Plan;
  onStepSelect?: (step: PlanStep) => void;
}

const nodeTypes = {
  planStep: PlanNode,
};

function buildNodesAndEdges(steps: PlanStep[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group steps by parent for hierarchical layout
  const rootSteps = steps.filter(s => !s.parentId);
  const childrenMap = new Map<string, PlanStep[]>();

  steps.forEach(step => {
    if (step.parentId) {
      const children = childrenMap.get(step.parentId) || [];
      children.push(step);
      childrenMap.set(step.parentId, children);
    }
  });

  // Position root nodes vertically
  const VERTICAL_SPACING = 150;
  const HORIZONTAL_SPACING = 300;

  const positionNode = (
    step: PlanStep,
    _index: number,
    x: number,
    y: number,
    _depth: number
  ): void => {
    const globalIndex = steps.findIndex(s => s.id === step.id);

    nodes.push({
      id: step.id,
      type: 'planStep',
      position: { x, y },
      data: { step, index: globalIndex },
    });

    // Add edge from parent
    if (step.parentId) {
      edges.push({
        id: `${step.parentId}-${step.id}`,
        source: step.parentId,
        target: step.id,
        type: 'smoothstep',
        animated: step.status === 'in_progress',
        style: { stroke: '#6b7280' },
      });
    }

    // Position children
    const children = childrenMap.get(step.id) || [];
    children.forEach((child, childIndex) => {
      const childX = x + (childIndex - (children.length - 1) / 2) * HORIZONTAL_SPACING;
      const childY = y + VERTICAL_SPACING;
      positionNode(child, childIndex, childX, childY, _depth + 1);
    });
  };

  // Position root steps
  rootSteps.forEach((step, index) => {
    const x = (index - (rootSteps.length - 1) / 2) * HORIZONTAL_SPACING + 400;
    const y = 50;
    positionNode(step, index, x, y, 0);

    // Add edges between sequential root steps
    if (index > 0) {
      edges.push({
        id: `${rootSteps[index - 1].id}-${step.id}-seq`,
        source: rootSteps[index - 1].id,
        target: step.id,
        type: 'smoothstep',
        animated: step.status === 'in_progress',
        style: { stroke: '#6b7280', strokeDasharray: '5,5' },
      });
    }
  });

  return { nodes, edges };
}

export default function PlanEditor({ plan, onStepSelect }: PlanEditorProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildNodesAndEdges(plan.steps),
    [plan.steps]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const step = plan.steps.find(s => s.id === node.id);
      if (step && onStepSelect) {
        onStepSelect(step);
      }
    },
    [plan.steps, onStepSelect]
  );

  return (
    <div className="w-full h-[500px] bg-gray-900 rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.5}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Controls className="!bg-gray-800 !border-gray-700" />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
      </ReactFlow>
    </div>
  );
}
