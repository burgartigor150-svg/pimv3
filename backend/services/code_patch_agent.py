import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

log = logging.getLogger(__name__)


def apply_patch(patch_content: str, repo_path: str) -> Tuple[bool, str]:
    """
    Apply a unified diff patch to the repository.
    Returns (success, error_message).
    """
    try:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.patch', delete=False) as f:
            f.write(patch_content)
            patch_file = f.name
        
        cmd = ['git', 'apply', '--check', patch_file]
        result = subprocess.run(cmd, cwd=repo_path, capture_output=True, text=True)
        if result.returncode != 0:
            return False, f"Patch check failed: {result.stderr}"
        
        cmd = ['git', 'apply', patch_file]
        result = subprocess.run(cmd, cwd=repo_path, capture_output=True, text=True)
        if result.returncode != 0:
            return False, f"Patch apply failed: {result.stderr}"
        
        os.unlink(patch_file)
        return True, ""
    except Exception as e:
        return False, str(e)


def apply_fallback_edit_ops(edit_ops: List[Dict], repo_path: str) -> Tuple[bool, str]:
    """
    Apply fallback edit operations directly to files.
    Each op should have keys: 'file_path', 'old_snippet', 'new_snippet'.
    Returns (success, error_message).
    """
    for i, op in enumerate(edit_ops):
        file_path = op.get('file_path')
        old_snippet = op.get('old_snippet')
        new_snippet = op.get('new_snippet')
        
        if not file_path or old_snippet is None or new_snippet is None:
            return False, f"Op[{i}] missing required fields"
        
        full_path = Path(repo_path) / file_path
        if not full_path.exists():
            return False, f"Op[{i}] file not found: {file_path}"
        
        try:
            content = full_path.read_text(encoding='utf-8')
            if content.count(old_snippet) != 1:
                return False, f"Op[{i}] old snippet matches={content.count(old_snippet)}, expected=1"
            
            new_content = content.replace(old_snippet, new_snippet)
            full_path.write_text(new_content, encoding='utf-8')
        except Exception as e:
            return False, f"Op[{i}] error: {str(e)}"
    
    return True, ""


def run_code_patch_agent(task_id: str, patch_content: str, repo_path: str) -> Dict:
    """
    Main function to apply a patch with fallback to edit operations.
    """
    success, error = apply_patch(patch_content, repo_path)
    if success:
        return {"status": "success", "message": "Patch applied successfully"}
    
    log.warning(f"Patch apply failed: {error}, attempting fallback edit ops")
    
    # Parse patch to extract edit operations (simplified for this example)
    edit_ops = []
    lines = patch_content.split('\n')
    current_file = None
    old_lines = []
    new_lines = []
    
    for line in lines:
        if line.startswith('--- '):
            current_file = line[4:].strip()
        elif line.startswith('+++ '):
            continue
        elif line.startswith('@@'):
            if current_file and old_lines and new_lines:
                edit_ops.append({
                    'file_path': current_file,
                    'old_snippet': '\n'.join(old_lines),
                    'new_snippet': '\n'.join(new_lines)
                })
                old_lines = []
                new_lines = []
        elif line.startswith('-'):
            old_lines.append(line[1:])
        elif line.startswith('+'):
            new_lines.append(line[1:])
        else:
            if old_lines and new_lines:
                old_lines.append(line)
                new_lines.append(line)
    
    if current_file and old_lines and new_lines:
        edit_ops.append({
            'file_path': current_file,
            'old_snippet': '\n'.join(old_lines),
            'new_snippet': '\n'.join(new_lines)
        })
    
    success, error = apply_fallback_edit_ops(edit_ops, repo_path)
    if success:
        return {"status": "success", "message": "Fallback edit ops applied successfully"}
    else:
        return {"status": "error", "error": error}
