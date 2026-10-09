import { defineMessages } from '../../platform/nls';

export const t = defineMessages('editor', {
  save: 'Save',
  dontSave: "Don't Save",
  saveChangesQuestion: 'Do you want to save the changes you made to {0}?',
  saveChangesDetail: "Your changes will be lost if you don't save them.",
  saveFailed: 'Failed to save "{0}".',
  changedOnDisk: 'The file has been changed on disk. Reload it, or keep your unsaved version?',
  reload: 'Reload',
  keepMine: 'Keep Mine',
  saveCommand: 'Save',
  revertCommand: 'Revert File',
  findCommand: 'Find',
  loadFailed: 'The editor failed to load: {0}',
  proposedChanges: 'Proposed changes',
  accept: 'Accept',
  reject: 'Reject',
  acceptCommand: 'Accept Proposed Changes',
  rejectCommand: 'Reject Proposed Changes',
  compareWithSaved: 'Compare Active File with Saved',
  compareWithSavedTitle: '{0} (on disk) ↔ {0}',
});
