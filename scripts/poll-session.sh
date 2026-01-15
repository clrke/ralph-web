#!/bin/bash
# Poll session status for different purposes
# Usage: ./poll-session.sh <project_id> <feature_id> [mode]
# Modes: stage1, stage2, approval, all (default)

PROJECT_ID="${1:-c36c4f449192026ca999ef7f3fae2a8d}"
FEATURE_ID="${2:-implement-stage-3-execution}"
MODE="${3:-all}"
SESSION_DIR="$HOME/.claude-web/$PROJECT_ID/$FEATURE_ID"
API_BASE="http://localhost:3333/api/sessions/$PROJECT_ID/$FEATURE_ID"

poll_status() {
  local STATUS=$(cat "$SESSION_DIR/status.json" 2>/dev/null | jq -r '.lastAction // "waiting"')
  local STAGE=$(curl -s "$API_BASE" 2>/dev/null | jq -r '.currentStage // 1')
  local STEPS=$(cat "$SESSION_DIR/plan.json" 2>/dev/null | jq '.steps | length' 2>/dev/null || echo "0")
  local UNANSWERED=$(cat "$SESSION_DIR/questions.json" 2>/dev/null | jq '[.questions[] | select(.answer == null)] | length' 2>/dev/null || echo "0")
  local APPROVED=$(cat "$SESSION_DIR/plan.json" 2>/dev/null | jq -r '.isApproved // false')

  echo "Stage: $STAGE | Steps: $STEPS | Unanswered: $UNANSWERED | Approved: $APPROVED | Action: $STATUS"

  # Return values for conditional checks
  echo "$STAGE|$STEPS|$UNANSWERED|$APPROVED|$STATUS"
}

wait_for_stage1() {
  echo "=== Waiting for Stage 1 completion ==="
  for i in {1..120}; do
    local result=$(poll_status)
    echo "[$i] $result"
    local status=$(cat "$SESSION_DIR/status.json" 2>/dev/null | jq -r '.lastAction // "waiting"')
    if [[ "$status" == *"stage1_complete"* ]]; then
      echo "Stage 1 complete!"
      return 0
    fi
    sleep 10
  done
  echo "Timeout waiting for Stage 1"
  return 1
}

wait_for_stage2() {
  echo "=== Waiting for Stage 2 ==="
  for i in {1..120}; do
    local result=$(poll_status)
    echo "[$i] $result"
    local stage=$(curl -s "$API_BASE" 2>/dev/null | jq -r '.currentStage // 1')
    if [[ "$stage" == "2" ]]; then
      echo "Stage 2 reached!"
      return 0
    fi
    sleep 10
  done
  echo "Timeout waiting for Stage 2"
  return 1
}

wait_for_approval() {
  echo "=== Waiting for Plan Approval ==="
  for i in {1..120}; do
    local result=$(poll_status)
    echo "[$i] $result"
    local approved=$(cat "$SESSION_DIR/plan.json" 2>/dev/null | jq -r '.isApproved // false')
    if [[ "$approved" == "true" ]]; then
      echo "Plan approved!"
      return 0
    fi
    local unanswered=$(cat "$SESSION_DIR/questions.json" 2>/dev/null | jq '[.questions[] | select(.answer == null)] | length' 2>/dev/null || echo "0")
    local status=$(cat "$SESSION_DIR/status.json" 2>/dev/null | jq -r '.lastAction // "waiting"')
    if [[ "$unanswered" -gt 0 ]] && [[ "$status" == *"complete"* ]]; then
      echo "New questions need answers!"
      show_unanswered
      return 2
    fi
    sleep 10
  done
  echo "Timeout waiting for approval"
  return 1
}

show_unanswered() {
  echo ""
  echo "=== Unanswered Questions ==="
  cat "$SESSION_DIR/questions.json" | jq '[.questions[] | select(.answer == null)] | .[] | {id, text: .questionText[0:100], options: [.options[].label[0:50]]}'
}

show_questions() {
  echo ""
  echo "=== All Questions ==="
  cat "$SESSION_DIR/questions.json" | jq '.questions[] | {id, answered: (.answer != null), text: .questionText[0:80]}'
}

show_plan() {
  echo ""
  echo "=== Plan Steps ==="
  cat "$SESSION_DIR/plan.json" | jq '.steps[] | {id, title, status}'
}

show_validation() {
  echo ""
  echo "=== Last Validation ==="
  cat "$SESSION_DIR/validation-logs.json" 2>/dev/null | jq '.entries[-1] | {total: .totalDecisions, passed: .passedCount, filtered: .filteredCount, repurposed: .repurposedCount}' || echo "No validation logs"
}

case "$MODE" in
  stage1)
    wait_for_stage1
    ;;
  stage2)
    wait_for_stage2
    ;;
  approval)
    wait_for_approval
    ;;
  questions)
    show_questions
    ;;
  unanswered)
    show_unanswered
    ;;
  plan)
    show_plan
    ;;
  validation)
    show_validation
    ;;
  status)
    poll_status
    ;;
  all)
    echo "Session: $PROJECT_ID/$FEATURE_ID"
    echo ""
    poll_status
    show_validation
    show_unanswered
    show_plan
    ;;
  *)
    echo "Usage: $0 <project_id> <feature_id> [mode]"
    echo "Modes: stage1, stage2, approval, questions, unanswered, plan, validation, status, all"
    ;;
esac
