const API = '/api';

document.addEventListener('DOMContentLoaded', () => {
    const btnLoad = document.getElementById('btn-load');
    const inputKey = document.getElementById('testplan-input');
    
    // UI Elements
    const loader = document.getElementById('loader');
    const errorMsg = document.getElementById('error-message');
    const dashboardContent = document.getElementById('dashboard-content');
    
    // Stat Elements
    const planTitle = document.getElementById('plan-title');
    const planKeyText = document.getElementById('plan-key');
    const progressCircle = document.getElementById('progress-circle');
    const progressValue = document.getElementById('progress-value');
    
    const statPassed = document.getElementById('stat-passed');
    const statFailed = document.getElementById('stat-failed');
    const statExecuting = document.getElementById('stat-executing');
    const statTodo = document.getElementById('stat-todo');
    
    const testListBody = document.getElementById('test-list-body');
    const filterAllCount = document.getElementById('filter-all-count');
    const filterBtns = document.querySelectorAll('.filter-btn');
    
    let currentTests = [];
    let currentFilter = 'all';

    // Event Listeners
    btnLoad.addEventListener('click', () => loadTrackingData(inputKey.value));
    inputKey.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadTrackingData(inputKey.value);
    });

    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            renderTestList();
        });
    });

    // Animate Number Counting
    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = Math.floor(progress * (end - start) + start);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    async function loadTrackingData(key) {
        if (!key.trim()) return;
        
        // Reset UI
        errorMsg.classList.add('hidden');
        dashboardContent.classList.add('hidden');
        loader.classList.remove('hidden');
        
        try {
            const response = await fetch(`${API}/jira/testplan/${encodeURIComponent(key.trim())}/tracking`);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to fetch tracking data');
            }
            
            updateDashboard(data);
            loader.classList.add('hidden');
            dashboardContent.classList.remove('hidden');
        } catch (err) {
            loader.classList.add('hidden');
            errorMsg.textContent = err.message;
            errorMsg.classList.remove('hidden');
        }
    }

    function updateDashboard(data) {
        // Update Headers
        planTitle.textContent = data.summary || 'Test Plan Execution';
        planKeyText.textContent = data.testPlanKey;
        
        const stats = data.stats;
        
        // Animate Circle
        // Circle circumference is 283
        const offset = 283 - (283 * stats.progress) / 100;
        progressCircle.style.strokeDashoffset = offset;
        
        // Quality Circle
        const qualityCircle = document.getElementById('quality-circle');
        const qualityValue = document.getElementById('quality-value');
        if (qualityCircle && qualityValue && stats.quality) {
            const qOffset = 283 - (283 * stats.quality.goal) / 100;
            qualityCircle.style.strokeDashoffset = qOffset;
            animateValue(qualityValue, 0, stats.quality.goal, 1000);
            
            const failNoDefect = document.getElementById('fail-no-defect');
            if (failNoDefect) animateValue(failNoDefect, 0, stats.quality.failedWithoutDefect, 800);
            const passNoEv = document.getElementById('pass-no-evidence');
            if (passNoEv) animateValue(passNoEv, 0, stats.quality.passedWithoutEvidence, 800);
        }
        
        // Animate Numbers
        animateValue(progressValue, 0, stats.progress, 1000);
        animateValue(statPassed, 0, stats.passed, 800);
        animateValue(statFailed, 0, stats.failed, 800);
        animateValue(statExecuting, 0, stats.executing, 800);
        animateValue(statTodo, 0, stats.todo, 800);
        
        filterAllCount.textContent = stats.total;
        
        currentTests = data.tests;
        
        // Render Executions
        const executionsContainer = document.getElementById('executions-container');
        const executionsList = document.getElementById('executions-list');
        
        if (data.executions && data.executions.length > 0) {
            executionsContainer.classList.remove('hidden');
            executionsList.innerHTML = '';
            
            data.executions.forEach(exec => {
                const card = document.createElement('div');
                card.className = 'exec-card';
                card.innerHTML = `
                    <div class="exec-header">
                        <div>
                            <div class="exec-title" title="${exec.summary || exec.key}">${exec.summary ? exec.summary.substring(0, 40) + (exec.summary.length > 40 ? '...' : '') : exec.key}</div>
                            <a href="https://si-emobility.atlassian.net/browse/${exec.key}" target="_blank" class="exec-key">${exec.key}</a>
                        </div>
                        <div style="font-weight: bold; color: var(--accent);">${exec.progress}%</div>
                    </div>
                    <div class="exec-progress-bar">
                        <div class="exec-progress-fill" style="width: 0%"></div>
                    </div>
                    <div class="exec-stats">
                        <span style="color: var(--passed)"><span class="material-icons" style="font-size: 14px">check_circle</span> ${exec.passed}</span>
                        <span style="color: var(--failed)"><span class="material-icons" style="font-size: 14px">cancel</span> ${exec.failed}</span>
                        <span style="color: var(--text-dim)"><span class="material-icons" style="font-size: 14px">schedule</span> ${exec.todo + exec.executing}</span>
                    </div>
                `;
                executionsList.appendChild(card);
                
                // Animate progress bar
                setTimeout(() => {
                    const fill = card.querySelector('.exec-progress-fill');
                    if(fill) fill.style.width = exec.progress + '%';
                }, 100);
            });
        } else {
            executionsContainer.classList.add('hidden');
        }

        renderTestList();
    }

    function renderTestList() {
        testListBody.innerHTML = '';
        
        const filtered = currentTests.filter(t => {
            if (currentFilter === 'all') return true;
            const s = t.status.toLowerCase();
            if (currentFilter === 'todo' && !['passed', 'failed', 'executing'].includes(s)) return true;
            return s === currentFilter;
        });
        
        filtered.forEach(t => {
            const tr = document.createElement('tr');
            
            const s = t.status.toLowerCase();
            let badgeClass = 'status-todo';
            if (s === 'passed') badgeClass = 'status-passed';
            else if (s === 'failed') badgeClass = 'status-failed';
            else if (s === 'executing') badgeClass = 'status-executing';
            
            const evidenceIcon = t.hasEvidence 
                ? '<span class="material-icons" style="color: var(--passed); font-size: 18px;" title="Has Evidence">attachment</span>' 
                : '<span class="material-icons" style="color: var(--text-dim); font-size: 18px; opacity: 0.3;" title="No Evidence">attachment</span>';
                
            let defectContent = '<span class="material-icons" style="color: var(--text-dim); font-size: 18px; opacity: 0.3;" title="No Defect">bug_report</span>';
            if (t.hasDefect) {
                const links = (t.defects || []).map(d => `<a href="https://si-emobility.atlassian.net/browse/${d}" target="_blank" style="color: var(--failed); text-decoration: underline; font-size: 0.8rem; margin-left: 4px;">${d}</a>`).join('');
                defectContent = `<div style="display: flex; align-items: center; justify-content: center;"><span class="material-icons" style="color: var(--failed); font-size: 18px;" title="Has Linked Defect">bug_report</span>${links}</div>`;
            }
            
            tr.innerHTML = `
                <td class="test-key"><a href="https://si-emobility.atlassian.net/browse/${t.key}" target="_blank" style="color: inherit; text-decoration: none;">${t.key}</a></td>
                <td class="test-summary">${t.summary || '-'}</td>
                <td style="text-align: center;">${evidenceIcon}</td>
                <td style="text-align: center;">${defectContent}</td>
                <td><span class="status-badge ${badgeClass}">${t.status}</span></td>
            `;
            testListBody.appendChild(tr);
        });
    }

    // Auto-load if key is present
    if (inputKey.value) {
        loadTrackingData(inputKey.value);
    }
});
