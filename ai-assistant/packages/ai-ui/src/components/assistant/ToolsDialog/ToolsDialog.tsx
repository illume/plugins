import type { MCPToolsConfig, MCPToolState } from '@headlamp-k8s/ai-common/mcp/types';
import { AVAILABLE_TOOLS } from '@headlamp-k8s/ai-common/tools/catalog/builtInTools';
import { Icon } from '@iconify/react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  InputAdornment,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ElectronMCPClient } from '../../../mcp/electron-client';
import type { MCPTool } from '../../../types/electron';
import { DefaultDialog } from '../../defaults/DefaultSlots/DefaultSlots';

/** Describes an MCP tool available for use in the assistant. */
interface DisplayMCPTool extends MCPTool {
  /** Name of the MCP server providing this tool. */
  server?: string;
}

/** Props for the ToolsDialog component that manages tool enablement. */
export interface ToolsDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Callback invoked when the dialog is closed. */
  onClose: () => void;
  /** Array of currently enabled tool identifiers. */
  enabledTools: string[];
  /** Callback invoked when the set of enabled tools changes. */
  onToolsChange: (enabledTools: string[]) => void;
  /** Component used to render the dialog shell. Falls back to MUI Dialog. */
  DialogSlot?: React.ElementType;
}

export const ToolsDialog: React.FC<ToolsDialogProps> = ({
  open,
  onClose,
  enabledTools,
  onToolsChange,
  DialogSlot = DefaultDialog,
}) => {
  const { t } = useTranslation();
  const [localEnabledTools, setLocalEnabledTools] = useState<string[]>(enabledTools);
  const [allKnownMcpTools, setAllKnownMcpTools] = useState<DisplayMCPTool[]>([]);
  const [mcpToolsConfig, setMcpToolsConfig] = useState<MCPToolsConfig>({});
  const [originalMcpConfig, setOriginalMcpConfig] = useState<MCPToolsConfig>({});
  const [isLoadingMcp, setIsLoadingMcp] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState('');
  const loadRequestId = React.useRef(0);
  const titleId = React.useId();

  // Load MCP tools when dialog opens
  useEffect(() => {
    const requestId = ++loadRequestId.current;
    if (open) {
      setSearchQuery('');
      setSaveError('');
      void loadMcpTools(requestId);
    }
    return () => {
      if (loadRequestId.current === requestId) {
        loadRequestId.current += 1;
      }
    };
  }, [open]);

  // Sync local state when enabledTools prop changes
  useEffect(() => {
    setLocalEnabledTools(enabledTools);
  }, [enabledTools]);

  // Parse MCP tool name to extract server and tool components
  const parseMcpToolName = (fullToolName: string): { serverName: string; toolName: string } => {
    const parts = fullToolName.split('__');
    if (parts.length >= 2) {
      return {
        serverName: parts[0],
        toolName: parts.slice(1).join('__'),
      };
    }
    return {
      serverName: 'default',
      toolName: fullToolName,
    };
  };

  // Check if an MCP tool is enabled in the configuration
  const isMcpToolEnabled = (toolName: string): boolean => {
    const { serverName, toolName: actualToolName } = parseMcpToolName(toolName);
    const serverConfig = mcpToolsConfig[serverName];
    if (!serverConfig || !serverConfig[actualToolName]) {
      return true; // Default to enabled for new tools
    }
    return serverConfig[actualToolName].enabled !== false;
  };

  const loadMcpTools = async (requestId: number): Promise<void> => {
    setIsLoadingMcp(true);
    try {
      const mcpClient = new ElectronMCPClient();
      if (!mcpClient.isAvailable()) {
        if (loadRequestId.current === requestId) {
          setSaveError(t('Failed to load MCP tools.'));
        }
        return;
      }

      // Load server configuration and tools configuration - these are our source of truth
      const toolsConfigResponse = await mcpClient.getToolsConfig();
      if (loadRequestId.current !== requestId) {
        return;
      }

      // Store MCP tools configuration
      if (toolsConfigResponse.success && toolsConfigResponse.config) {
        setMcpToolsConfig(toolsConfigResponse.config);
        setOriginalMcpConfig(structuredClone(toolsConfigResponse.config));
      } else {
        setSaveError(t('Failed to load MCP tools.'));
      }

      // Create tools from configuration (this is our source of truth)
      const toolsFromConfig: DisplayMCPTool[] = [];
      if (toolsConfigResponse.success && toolsConfigResponse.config) {
        Object.entries(toolsConfigResponse.config).forEach(([serverName, serverTools]) => {
          Object.keys(serverTools).forEach(toolName => {
            const fullToolName = `${serverName}__${toolName}`;
            toolsFromConfig.push({
              name: fullToolName,
              description: t('Tool: {{toolName}}', { toolName }),
              server: serverName,
            });
          });
        });
      }

      // Update allKnownMcpTools with tools from configuration
      setAllKnownMcpTools(prevKnown => {
        const knownToolNames = new Set(prevKnown.map(tool => tool.name));
        const newToolsFromConfig = toolsFromConfig.filter(tool => !knownToolNames.has(tool.name));
        return [...prevKnown, ...newToolsFromConfig];
      });

      // Auto-expand servers that have tools in configuration
      const serversWithTools = new Set<string>();
      toolsFromConfig.forEach(tool => {
        if (tool.server) {
          serversWithTools.add(tool.server);
        }
      });
      setExpandedServers(serversWithTools);
    } catch {
      if (loadRequestId.current === requestId) {
        setSaveError(t('Failed to load MCP tools.'));
      }
    } finally {
      if (loadRequestId.current === requestId) {
        setIsLoadingMcp(false);
      }
    }
  };

  const handleToggleRegularTool = (toolName: string): void => {
    setLocalEnabledTools(prevTools => {
      if (prevTools.includes(toolName)) {
        return prevTools.filter(tool => tool !== toolName);
      } else {
        return [...prevTools, toolName];
      }
    });
  };

  const handleToggleMcpTool = (toolName: string): void => {
    const { serverName, toolName: actualToolName } = parseMcpToolName(toolName);
    const currentlyEnabled = isMcpToolEnabled(toolName);

    setMcpToolsConfig(prevConfig => {
      const currentTool: MCPToolState = prevConfig[serverName]?.[actualToolName] ?? {
        usageCount: 0,
      };
      return {
        ...prevConfig,
        [serverName]: {
          ...(prevConfig[serverName] ?? {}),
          [actualToolName]: { ...currentTool, enabled: !currentlyEnabled },
        },
      };
    });
  };

  const handleToggleServer = (serverName: string): void => {
    const serverTools = allKnownMcpTools.filter(tool => tool.server === serverName);

    // Check if all tools from this server are currently enabled
    const allEnabled = serverTools.every(tool => isMcpToolEnabled(tool.name));

    // Update MCP configuration for all tools in this server
    setMcpToolsConfig(prevConfig => {
      const serverConfig = { ...(prevConfig[serverName] ?? {}) };
      serverTools.forEach(tool => {
        const { toolName: actualToolName } = parseMcpToolName(tool.name);
        serverConfig[actualToolName] = {
          ...(serverConfig[actualToolName] ?? { usageCount: 0 }),
          enabled: !allEnabled,
        };
      });
      return { ...prevConfig, [serverName]: serverConfig };
    });
  };

  const isServerEnabled = (serverName: string): boolean => {
    const serverTools = allKnownMcpTools.filter(tool => tool.server === serverName);
    return serverTools.length > 0 && serverTools.every(tool => isMcpToolEnabled(tool.name));
  };

  // Filter tools based on search query - use allKnownMcpTools to show all tools (including disabled ones)
  const filteredMcpTools = allKnownMcpTools.filter(
    tool =>
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (tool.description && tool.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Group tools by server
  const groupedToolsByServer = filteredMcpTools.reduce((acc, tool) => {
    const serverName = tool.server || 'Unknown Server';
    if (!acc[serverName]) {
      acc[serverName] = [];
    }
    acc[serverName].push(tool);
    return acc;
  }, {} as Record<string, DisplayMCPTool[]>);

  const handleToggleServerExpansion = (serverName: string): void => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverName)) {
      newExpanded.delete(serverName);
    } else {
      newExpanded.add(serverName);
    }
    setExpandedServers(newExpanded);
  };

  const handleSave = async (): Promise<void> => {
    try {
      setSaveError('');
      // Save MCP tools configuration if it has changed
      const mcpConfigChanged = JSON.stringify(mcpToolsConfig) !== JSON.stringify(originalMcpConfig);

      if (mcpConfigChanged) {
        const mcpClient = new ElectronMCPClient();
        if (!mcpClient.isAvailable() || !(await mcpClient.updateToolsConfig(mcpToolsConfig))) {
          setSaveError(t('Failed to save MCP tool settings.'));
          return;
        }
      }

      onToolsChange(localEnabledTools);
      onClose();
    } catch {
      setSaveError(t('Failed to save tool settings.'));
    }
  };

  const handleCancel = (): void => {
    // Restore original state for both regular and MCP tools
    setLocalEnabledTools(enabledTools);
    setMcpToolsConfig(structuredClone(originalMcpConfig));
    onClose();
  };

  const getToolIcon = (toolName: string, toolType?: string): string => {
    if (toolType === 'mcp' || toolName.includes('mcp')) {
      return 'mdi:connection';
    }
    if (toolName.includes('kubernetes') || toolName.includes('k8s')) {
      return 'mdi:kubernetes';
    }
    return 'mdi:tool';
  };

  const renderMcpToolList = () => (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography component="h3" variant="h6" sx={{ mb: 0.5 }}>
          {t('MCP Tools')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t(
            'These are Model Context Protocol tools that provide additional capabilities to the assistant.'
          )}
        </Typography>

        {/* Search Bar */}
        <TextField
          fullWidth
          label={t('Search MCP tools')}
          placeholder={t('Search MCP tools...')}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          size="small"
          sx={{ mt: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Icon aria-hidden icon="mdi:magnify" style={{ fontSize: 20 }} />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {isLoadingMcp ? (
        <Box role="status" sx={{ display: 'flex', justifyContent: 'center', my: 3 }}>
          <CircularProgress aria-hidden size={24} />
          <Typography variant="body2" sx={{ ml: 2 }}>
            {t('Loading MCP tools...')}
          </Typography>
        </Box>
      ) : (
        <>
          {Object.entries(groupedToolsByServer).map(([serverName, tools]) => (
            <Accordion
              key={serverName}
              expanded={expandedServers.has(serverName)}
              onChange={() => handleToggleServerExpansion(serverName)}
              TransitionProps={{ timeout: 0 }}
              sx={{ mb: 1 }}
            >
              <AccordionSummary
                id={`${titleId}-${serverName}-summary`}
                aria-controls={`${titleId}-${serverName}-details`}
                expandIcon={<Icon aria-hidden icon="mdi:chevron-down" />}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                    <Icon aria-hidden icon="mdi:server" style={{ fontSize: 20 }} />
                    <Typography component="h4" variant="subtitle1">
                      {tools.length === 1
                        ? t('{{serverName}} (1 tool)', { serverName })
                        : t('{{serverName}} ({{count}} tools)', {
                            serverName,
                            count: tools.length,
                          })}
                    </Typography>
                  </Box>
                </Box>
              </AccordionSummary>
              <AccordionDetails id={`${titleId}-${serverName}-details`} sx={{ p: 0 }}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 2, pt: 1 }}>
                  <Switch
                    size="small"
                    checked={isServerEnabled(serverName)}
                    onChange={() => handleToggleServer(serverName)}
                    inputProps={{
                      'aria-label': t('Enable all tools from {{serverName}}', { serverName }),
                    }}
                  />
                </Box>
                <List sx={{ pl: 2 }}>
                  {tools.map((tool, index) => (
                    <React.Fragment key={`${serverName}-${tool.name}`}>
                      <ListItem divider={index < tools.length - 1}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            minWidth: 40,
                            justifyContent: 'center',
                            mr: 1,
                          }}
                        >
                          <Icon
                            aria-hidden
                            icon={getToolIcon(tool.name, 'mcp')}
                            style={{ fontSize: 18, marginRight: 8 }}
                          />
                        </Box>

                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="body1">{tool.name}</Typography>
                              <Chip label={t('MCP')} size="small" color="info" variant="outlined" />
                            </Box>
                          }
                          secondary={tool.description}
                        />

                        <ListItemSecondaryAction>
                          <Switch
                            size="small"
                            edge="end"
                            onChange={() => handleToggleMcpTool(tool.name)}
                            checked={isMcpToolEnabled(tool.name)}
                            inputProps={{
                              'aria-label': t('Enable {{toolName}}', { toolName: tool.name }),
                            }}
                          />
                        </ListItemSecondaryAction>
                      </ListItem>
                    </React.Fragment>
                  ))}
                </List>
              </AccordionDetails>
            </Accordion>
          ))}

          {filteredMcpTools.length === 0 && allKnownMcpTools.length > 0 && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontStyle: 'italic', textAlign: 'center', py: 3 }}
            >
              {t('No tools match your search query.')}
            </Typography>
          )}

          {allKnownMcpTools.length === 0 && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontStyle: 'italic', textAlign: 'center', py: 3 }}
            >
              {t('No MCP tools available. Connect to MCP servers to see available tools.')}
            </Typography>
          )}
        </>
      )}
    </>
  ); // Get tool categories
  const kubernetesTools = AVAILABLE_TOOLS.filter(ToolClass => {
    const tempTool = new ToolClass();
    return tempTool.config.name.includes('kubernetes') || tempTool.config.name.includes('k8s');
  });

  const otherTools = AVAILABLE_TOOLS.filter(ToolClass => {
    const tempTool = new ToolClass();
    return !tempTool.config.name.includes('kubernetes') && !tempTool.config.name.includes('k8s');
  });

  const renderToolList = (
    tools: typeof AVAILABLE_TOOLS,
    title: string,
    subtitle?: string
  ): React.ReactNode => (
    <>
      <Box sx={{ mb: 2 }}>
        <Typography component="h3" variant="h6" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>

      <List>
        {tools.map(ToolClass => {
          const tempTool = new ToolClass();
          const toolName = tempTool.config.name;
          const isEnabled = localEnabledTools.includes(toolName);

          return (
            <ListItem key={toolName} divider>
              <Box sx={{ display: 'flex', alignItems: 'center', mr: 2 }}>
                <Icon
                  aria-hidden
                  icon={getToolIcon(toolName)}
                  style={{ fontSize: 20, marginRight: 8 }}
                />
              </Box>
              <ListItemText
                primary={<Typography variant="body1">{toolName}</Typography>}
                secondary={tempTool.config.shortDescription || tempTool.config.description}
              />
              <ListItemSecondaryAction>
                <Switch
                  edge="end"
                  onChange={() => handleToggleRegularTool(toolName)}
                  checked={isEnabled}
                  color="primary"
                  inputProps={{
                    'aria-label': t('Enable {{toolName}}', {
                      toolName,
                    }),
                  }}
                />
              </ListItemSecondaryAction>
            </ListItem>
          );
        })}
      </List>
    </>
  );

  return (
    <DialogSlot
      open={open}
      onClose={handleCancel}
      aria-labelledby={titleId}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { height: '80vh' },
      }}
    >
      <DialogTitle id={titleId}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icon aria-hidden icon="mdi:tools" style={{ fontSize: 24 }} />
          <Typography component="span" variant="h6">
            {t('Manage Tools')}
          </Typography>
          <Chip
            label={
              localEnabledTools.length === 1
                ? t('1 built-in tool enabled')
                : t('{{count}} built-in tools enabled', { count: localEnabledTools.length })
            }
            size="small"
            color="primary"
          />
        </Box>
      </DialogTitle>

      <DialogContent>
        {saveError && (
          <Typography role="alert" color="error" sx={{ mb: 2 }}>
            {saveError}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t(
            'Enable or disable tools that the AI can use. Changes will take effect immediately and will be saved to your settings.'
          )}
        </Typography>

        {/* Kubernetes Tools */}
        {kubernetesTools.length > 0 && (
          <>
            {renderToolList(
              kubernetesTools,
              t('Kubernetes Tools'),
              t('Tools for interacting with Kubernetes clusters')
            )}
            <Divider sx={{ my: 3 }} />
          </>
        )}

        {/* Other Tools */}
        {otherTools.length > 0 &&
          renderToolList(
            otherTools,
            t('System Tools'),
            t('General purpose tools for various operations')
          )}

        {/* MCP Tools */}
        {renderMcpToolList()}

        {(kubernetesTools.length > 0 || otherTools.length > 0) && <Divider sx={{ my: 3 }} />}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleCancel}>{t('Cancel')}</Button>
        <Button onClick={handleSave} variant="contained">
          {t('Save Changes')}
        </Button>
      </DialogActions>
    </DialogSlot>
  );
};
