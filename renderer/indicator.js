const indicator = document.getElementById('indicator');
indicator.addEventListener('click', () => {
  window.ocApi.notifyIndicatorClick();
});
