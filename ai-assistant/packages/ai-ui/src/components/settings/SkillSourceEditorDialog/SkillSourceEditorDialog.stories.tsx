import type { Meta, StoryObj } from '@storybook/react';
import type { SkillSourceEntry } from '../SkillSettings/SkillSettings';
import SkillSourceEditorDialog, {
  type SkillSourceEditorDialogProps,
} from './SkillSourceEditorDialog';

const meta = {
  title: 'AI UI/SkillSourceEditorDialog',
  component: SkillSourceEditorDialog,
} satisfies Meta<typeof SkillSourceEditorDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const existingSkillSourceUrls = ['https://github.com/example/platform-skills'];

export const newSkillSourceArgs: SkillSourceEditorDialogProps = {
  open: true,
  onClose: () => undefined,
  onSave: () => undefined,
  existingUrls: existingSkillSourceUrls,
};
export const NewSource: Story = { args: newSkillSourceArgs };

export const existingSkillSource: SkillSourceEntry = {
  type: 'git',
  url: 'https://github.com/example/cluster-skills',
  ref: 'main',
  path: 'skills/',
  enabled: true,
  sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
};

export const editSkillSourceArgs: SkillSourceEditorDialogProps = {
  ...newSkillSourceArgs,
  source: existingSkillSource,
  existingUrls: [...existingSkillSourceUrls, existingSkillSource.url],
};
export const EditExisting: Story = { args: editSkillSourceArgs };

export const closedSkillSourceArgs: SkillSourceEditorDialogProps = {
  ...newSkillSourceArgs,
  open: false,
};
export const Closed: Story = { args: closedSkillSourceArgs };
