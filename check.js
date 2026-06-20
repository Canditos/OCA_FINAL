
let jiraUploadBatchRunId = null;
let _loadedHistoryResults = [];
function uploadRunToJira() {
  if (!_loadedHistoryResults || !_loadedHistoryResults.length) {
    alert("No results to upload");
    return;
  }
  openJiraUploadModal(_loadedHistoryResults);
}
  if(localStorage.getItem('theme')==='light')document.documentElement.classList.add('light-theme');

