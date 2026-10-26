import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LoadingProvider } from './contexts/LoadingContext';
import { checkAndMigratePort } from './utils/portMigration';
import PromptRegistry from './services/PromptRegistry';
import { migrateSessionMessagesInLocalStorage } from './services/chat/sessionMessagesMigration';
import {
  ensureDefaultCloudProvidersInLocalStorage,
  ensureDefaultKgmChatDefaultsInLocalStorage
} from './utils/defaultCloudProviders';
import { migrateMisconfiguredLocalServiceUrls } from './utils/kgmBrowserBaseUrl';
import './styles/loading.css';
import './styles/markdown.css';
import './styles/chat-message-typography.css';
import './styles/chat-markdown-spec.css';
import './styles/toast-layout.css';
import { message } from 'antd';

message.config({ maxCount: 4, duration: 3 });

checkAndMigratePort();
migrateMisconfiguredLocalServiceUrls();
ensureDefaultKgmChatDefaultsInLocalStorage();
ensureDefaultCloudProvidersInLocalStorage();

const rootEl = document.getElementById('root')!;

void Promise.all([
  PromptRegistry.getInstance().ensureHydrated(),
  Promise.resolve(migrateSessionMessagesInLocalStorage())
])
  .finally(() => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <LoadingProvider>
          <App />
        </LoadingProvider>
      </React.StrictMode>
    );
  });