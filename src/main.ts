import './style.css';
import { App } from './platform/app';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');
const app = new App(root);
// QA hook: inspect the app (renderer, core, last output) from the devtools console.
(window as unknown as { __app: App }).__app = app;
app.init().catch((err) => {
  console.error(err);
  alert(`초기화 실패: ${err instanceof Error ? err.message : err}`);
});
