/**
 * The storage owner admits these reads and durable intents through ordinary
 * Account credentials. All other operations require the exact worker publisher;
 * unknown operations fail closed rather than acquiring Account authority.
 */
export function isWorkflowRunExecutorStorageOperationV1(operation: unknown): boolean {
  switch (operation) {
    case 'get':
    case 'wait':
    case 'list':
    case 'summaries':
    case 'delivery.pull':
    case 'delivery.ack':
    case 'origin-input.withdrawn':
    case 'invocations.list':
    case 'invocations.get':
    case 'invocations.current':
    case 'invocations.publish_draft':
    case 'invocations.complete_review':
    case 'run-key.census':
    case 'run-key.commit':
    case 'pause':
    case 'resume':
    case 'cancel':
    case 'delete':
      return false;
    default:
      return true;
  }
}
