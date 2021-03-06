" vim:set ft=vim: "
set encoding=utf-8
let mapleader = ' '
set bs=eol,start,indent
set ic is scs sw=4 ts=4 et termguicolors hidden nu splitbelow splitright mouse=a diffopt+=vertical laststatus=0 cursorline
colorscheme industry

call plug#begin('~/.vim/bundle')
Plug 'fatih/vim-go'", { 'do': ':GoUpdateBinaries' }
"Auto pair
Plug 'cohama/lexima.vim'
Plug 'christoomey/vim-tmux-navigator'
Plug 'tpope/vim-unimpaired'
Plug 'tpope/vim-dispatch'
Plug 'radenling/vim-dispatch-neovim'
Plug 'tpope/vim-rhubarb'
Plug 'tpope/vim-surround'
Plug 'tpope/vim-repeat'
Plug 'tpope/vim-fugitive'
"fugitive vim
"{{{
nnoremap gw :Gwrite<Enter>
nnoremap gs :Gstatus<Enter>
nnoremap gc :Git commit --gpg-sign -s <Enter>
nnoremap gp :Dispatch! git push
nnoremap gpf :Dispatch! push --force
nnoremap gca :Git commit --gpg-sign -S --amend
nnoremap gpl :Dispatch git pull --rebase
" Commenting for fugitive commit session
" will take branch name as #Issue-number
" Ref: https://github.com/tpope/vim-fugitive/commit/d4bcc75ef6449c0e5592513fb1e0a42b017db9ca
let @w='5G$vByggIIssue #000 feat: <CR><CR><ESC>pggA'
let @e='ggIIssue #000 feat: '
let @r='ggIIssue #000 fix: '

" " Enabling async :Gpush and :Gpull
" command! -bang -bar -nargs=* Gpush execute 'Dispatch<bang> -dir=' .
"       \ fnameescape(FugitiveGitDir()) 'git push' <q-args>
" command! -bang -bar -nargs=* Gfetch execute 'Dispatch<bang> -dir=' .
"       \ fnameescape(FugitiveGitDir()) 'git fetch' <q-args>
"}}}
" Plug 'AGhost-7/critiq.vim'
Plug 'junegunn/gv.vim'
Plug 'gruvbox-community/gruvbox'
Plug 'flazz/vim-colorschemes'
" Plug 'TaDaa/vimade'
Plug 'tmux-plugins/vim-tmux-focus-events'
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
Plug 'scrooloose/nerdtree', { 'on': ['NERDTreeFind', 'NERDTreeToggle'] }
"{{{
"NERDTreefind
nnoremap <silent> ff :NERDTreeFind <Enter>
"NERDTree toggle
nnoremap <silent> <C-n> :NERDTreeToggle<CR>
"}}}
Plug 'scrooloose/nerdcommenter'
"{{{
" Add spaces after comment delimiters by default
let g:NERDSpaceDelims = 1

" Use compact syntax for prettified multi-line comments
let g:NERDCompactSexyComs = 1
" Align line-wise comment delimiters flush left instead of following code indentation
let g:NERDDefaultAlign = 'left'
" Allow commenting and inverting empty lines (useful when commenting a region)
let g:NERDCommentEmptyLines = 1
" Enable trimming of trailing whitespace when uncommenting
let g:NERDTrimTrailingWhitespace = 1
"}}}
Plug 'wincent/ferret'
"{{{
let g:FerretJob=0
let g:FerretMaxResults=1000
" vnoremap /s "zy:Ack! -w --ignore *\.wiki --ignore *doc --ignore ekstep-devops <c-r>z<CR>
" Override default args
let g:FerretExecutableArguments = {
  \   'rg': '--column --with-filename -S'
  \ }

vnoremap <silent> /S "zy:Ack! -w <c-r>z<CR>
vnoremap <silent> /s "zy:Ack!  <c-r>z<CR>
"}}}
Plug 'junegunn/fzf', { 'do': { -> fzf#install() } }
"{{{
nnoremap <silent> <leader>p <nop>
"}}}
Plug 'junegunn/fzf.vim'
Plug 'junegunn/vim-easy-align'
"{{{
" Start interactive EasyAlign in visual mode (e.g. vipga)
xmap ga <Plug>(EasyAlign)
" Start interactive EasyAlign for a motion/text object (e.g. gaip)
nmap ga <Plug>(EasyAlign)
"}}}
Plug 'iamcco/markdown-preview.nvim', { 'do': { -> mkdp#util#install() }, 'for': ['markdown', 'vim-plug']}
Plug 'vimwiki/vimwiki'
"{{{
" customization for wiki
let wiki_personal= {'path': '~/vimwiki_personal/', 'syntax': 'markdown', 'ext': '.md'}
let wiki_work = {'path': '~/vimwiki/', 'syntax': 'markdown', 'ext': '.md'}
let g:vimwiki_list = [wiki_work, wiki_personal]
let g:vimwiki_ext2syntax = {'.md': 'markdown',
                  \ '.mkd': 'markdown',
                  \ '.wiki': 'media'}
let g:vimwiki_folding=''
" map gc<Space> <Plug>VimwikiToggleListItem
"}}}
Plug 'pearofducks/ansible-vim', { 'do': 'cd ./UltiSnips; ./generate.py --style dictionary' }
"{{{
let g:ansible_attribute_highlight = "ob"
let g:ansible_name_highlight = 'd'
let g:ansible_extra_keywords_highlight = 1
let g:ansible_normal_keywords_highlight = 'Constant'
"}}}
Plug 'easymotion/vim-easymotion'
"{{{
" Easymotion plug
" Jump to anywhere you want with minimal keystrokes, with just one key binding.
" `s{char}{label}`
nmap <silent> , <Plug>(easymotion-overwin-f2)

" Replacing hjkl
" Gif config
map <silent> <Leader>j <Plug>(easymotion-j)
map <silent> <Leader>k <Plug>(easymotion-k)
let g:EasyMotion_startofline = 0 " keep cursor column when JK motion
"}}}
" Plug 'justinmk/vim-sneak'
"{{{
" let g:sneak#label = 1
" map f <Plug>Sneak_f
" map F <Plug>Sneak_F
" map t <Plug>Sneak_t
" map T <Plug>Sneak_T
"}}}

Plug 'unblevable/quick-scope'
"{{{

" Trigger a highlight in the appropriate direction when pressing these keys:
let g:qs_highlight_on_keys = ['f', 'F', 't', 'T']

" Trigger a highlight only when pressing f and F.
let g:qs_highlight_on_keys = ['f', 'F']
"}}}

Plug '907th/vim-auto-save'
"{{{
let g:auto_save_events = ["CursorHold"]
set updatetime=600
"}}}
" Platform
Plug 'rjshrjndrn/vim-kubernetes'

" Programming language function overview.
Plug 'liuchengxu/vista.vim'

" Language grammer check
" Plug 'vigoux/LanguageTool.nvim'

" HTML
Plug 'mattn/emmet-vim'
" Use release branch (recommend)
Plug 'neoclide/coc.nvim', {'branch': 'release'}
" Autocompletion engine
" {{{
let g:coc_global_extensions = [
            \'coc-vimlsp',
            \'coc-tabnine',
            \'coc-snippets',
            \'coc-git',
            \'coc-eslint',
            \'coc-emoji',
            \'coc-yaml@1.0.4',
            \'coc-tsserver',
            \'coc-tslint',
            \'coc-pyright',
            \'coc-emmet',
            \'coc-json'
        \]
            " \'coc-tsserver',
            " \'coc-tslint',
" }}}

" To see all color schemes
" help: https://vim.fandom.com/wiki/Switch_color_schemes
" Plug 'felixhummel/setcolors.vim'
call plug#end()

" Themes
" {{{
" colorscheme solarized8_flat
" colorscheme molokai
colorscheme gruvbox
let g:airline_theme='distinguished'
" colorscheme nord
" set background=dark
let g:gruvbox_contrast_dark = 'medium'
let g:gruvbox_italicize_comments = 1
" }}}

" AuGroup Commands
" {{{
augroup auto_go
    autocmd!
    autocmd FileType go set foldmethod=syntax foldlevel=1 foldnestmax=2
    autocmd BufWritePre *.go :GoDiagnostics
    autocmd BufWritePost *_test.go :GoTest
augroup end

augroup auto_vim
    autocmd!
    autocmd FileType vim set foldmethod=marker
augroup END

augroup auto_vimwiki
    autocmd!
    au BufEnter,BufNewFile ~/vimwiki/* let b:auto_save=1 | lcd ~/vimwiki | setlocal spell sw=2 sts=2 et ts=2
augroup END

augroup auto_markdown_gitcommit
    autocmd!
    autocmd FileType markdown,gitcommit setlocal spell sw=2 sts=2 et ts=2
augroup END

augroup auto_yaml
    autocmd!
    autocmd FileType yaml setlocal sw=2 sts=2 et ts=2 | nnoremap <silent> ]r :call FindAnsibleRoleUnderCursor()<CR>
augroup END
augroup auto_ansible
    autocmd!
    au BufEnter,BufNewFile */ansible/*.y[a]\\\{0,1\}ml setlocal ft=yaml.ansible
augroup END
" }}}

" Custom Undo
set undofile
if !has('nvim')
    set undodir=~/.vim/undo
endif

" Functions
" {{{
function! DiffToggle(diff)
    "named argument diff
    if a:diff
        :windo diffoff
    else
        :windo diffthis
    endif
endfunction
nnoremap <silent> <leader>d :call DiffToggle(&diff)<CR>


let g:ansible_goto_role_paths = './roles,../_common/roles'

function! FindAnsibleRoleUnderCursor()
  if exists("g:ansible_goto_role_paths")
    let l:role_paths = g:ansible_goto_role_paths
  else
    let l:role_paths = "./roles"
  endif
  let l:tasks_main = expand("<cfile>") . "/tasks/main.yml"
  let l:found_role_path = findfile(l:tasks_main, l:role_paths)
  if l:found_role_path == ""
    echo l:tasks_main . " not found"
  else
    execute "edit " . fnameescape(l:found_role_path)
  endif
endfunction

" }}}

" Keyboard Mappings
" {{{
" Vista function overview
nnoremap <leader>v :Vista finder<CR>

nnoremap <silent><leader>w :w<CR>
" quit
nnoremap <silent><leader>q :q<CR>
nnoremap <silent><leader>Q :qa<CR>
" Folding
nnoremap <silent><leader>f za
nnoremap <silent><leader>F zA
vnoremap <silent><leader>f :fold<CR>

" visual select
vnoremap // "zy/<C-R>z<CR>
vnoremap /b "zy:Back! <C-R>z<CR>
vnoremap /B "zy:Back! -w <C-R>z<CR>

" Copying to system clipboard
vnoremap Y "+y

" Switch windows
nnoremap <c-j> <c-w>j
nnoremap <c-k> <c-w>k
nnoremap <c-h> <c-w>h
nnoremap <c-l> <c-w>l
if has('nvim')
    " Escape mode
    tnoremap <C-b><C-b> <C-\><C-n>
    " shell jumping
    tnoremap <c-h> <c-\><c-n><c-w>h
    tnoremap <c-j> <c-\><c-n><c-w>j
    tnoremap <c-k> <c-\><c-n><c-w>k
    tnoremap <c-l> <c-\><c-n><c-w>l
endif

"Undo map
nnoremap <silent> U :UndotreeToggle<CR>:UndotreeFocus<CR>

" Command mode history
cmap <M-h> <left>
cmap <M-l> <right>
cmap <M-k> <up>
cmap <M-j> <down>
" tabbing to complete popups
inoremap <silent><expr><tab> pumvisible() ? "\<c-n>" : "\<tab>"
inoremap <silent><expr><s-tab> pumvisible() ? "\<c-p>" : "\<s-tab>"

" search through buffers using fzf
nnoremap <silent><leader>b :Buffers<CR>
" search through files in current dir using fzf
nnoremap <C-p> :<C-u>Files<cr>
" search through history using fzf
nnoremap <silent><leader>h :History<CR>

"}}}

" Popup window for fzf
" Terminal buffer options for fzf
" {{{
autocmd! FileType fzf
autocmd  FileType fzf set noshowmode noruler nonu

if has('nvim') && exists('&winblend') && &termguicolors
  set winblend=20

  hi NormalFloat guibg=None
  if exists('g:fzf_colors.bg')
    call remove(g:fzf_colors, 'bg')
  endif

  if stridx($FZF_DEFAULT_OPTS, '--border') == -1
    let $FZF_DEFAULT_OPTS .= ' --border'
  endif

  function! FloatingFZF()
    let width = float2nr(&columns * 0.8)
    let height = float2nr(&lines * 0.6)
    let opts = { 'relative': 'editor',
               \ 'row': (&lines - height) / 2,
               \ 'col': (&columns - width) / 2,
               \ 'width': width,
               \ 'height': height }

    call nvim_open_win(nvim_create_buf(v:false, v:true), v:true, opts)
  endfunction

  let g:fzf_layout = { 'window': 'call FloatingFZF()' }
endif

" hack to commit the dotfiles
command! ConfigAdd !/usr/bin/git --git-dir=$HOME/dotfiles/ --work-tree=$HOME add %
command! ConfigCommit !/usr/bin/git --git-dir=$HOME/dotfiles/ --work-tree=$HOME commit -m "
command! ConfigPush !/usr/bin/git --git-dir=$HOME/dotfiles/ --work-tree=$HOME push

command! -bang -nargs=? -complete=dir Files
        \ call fzf#vim#files(<q-args>, fzf#vim#with_preview({'options': ['--layout=reverse', '--info=inline']}), <bang>0)

"}}}

" COC-settings
"{{{
" Plugins
" TextEdit might fail if hidden is not set.
set hidden

" Some servers have issues with backup files, see #649.
set nobackup
set nowritebackup

" Give more space for displaying messages.
set cmdheight=2

" Having longer updatetime (default is 4000 ms = 4 s) leads to noticeable
" delays and poor user experience.
set updatetime=300

" Don't pass messages to |ins-completion-menu|.
set shortmess+=c

" Always show the signcolumn, otherwise it would shift the text each time
" diagnostics appear/become resolved.
if has("patch-8.1.1564")
  " Recently vim can merge signcolumn and number column into one
  set signcolumn=number
else
  set signcolumn=yes
endif

" Use tab for trigger completion with characters ahead and navigate.
" NOTE: Use command ':verbose imap <tab>' to make sure tab is not mapped by
" other plugin before putting this into your config.
inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()
inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<C-h>"

function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

" Use <c-space> to trigger completion.
inoremap <silent><expr> <c-space> coc#refresh()

" Use <cr> to confirm completion, `<C-g>u` means break undo chain at current
" position. Coc only does snippet and additional edit on confirm.
" <cr> could be remapped by other vim plugin, try `:verbose imap <CR>`.
if exists('*complete_info')
  inoremap <expr> <cr> complete_info()["selected"] != "-1" ? "\<C-y>" : "\<C-g>u\<CR>"
else
  inoremap <expr> <cr> pumvisible() ? "\<C-y>" : "\<C-g>u\<CR>"
endif

" Use `[g` and `]g` to navigate diagnostics
" Use `:CocDiagnostics` to get all diagnostics of current buffer in location list.
nmap <silent> [g <Plug>(coc-diagnostic-prev)
nmap <silent> ]g <Plug>(coc-diagnostic-next)

" GoTo code navigation.
nmap <silent> gD <Plug>(coc-definition)
nmap <silent> gY <Plug>(coc-type-definition)
nmap <silent> gI <Plug>(coc-implementation)
nmap <silent> gR <Plug>(coc-references)

" Use K to show documentation in preview window.
nnoremap <silent> gK :call <SID>show_documentation()<CR>

function! s:show_documentation()
  if (index(['vim','help'], &filetype) >= 0)
    execute 'h '.expand('<cword>')
  else
    call CocAction('doHover')
  endif
endfunction

" Highlight the symbol and its references when holding the cursor.
autocmd CursorHold * silent call CocActionAsync('highlight')

" Symbol renaming.
nmap <leader>rn <Plug>(coc-rename)

" Formatting selected code.
" xmap <leader>F  <Plug>(coc-format-selected)
" nmap <leader>F  <Plug>(coc-format-selected)

augroup mygroup
  autocmd!
  " Setup formatexpr specified filetype(s).
  autocmd FileType typescript,json setl formatexpr=CocAction('formatSelected')
  " Update signature help on jump placeholder.
  autocmd User CocJumpPlaceholder call CocActionAsync('showSignatureHelp')
augroup end

" Applying codeAction to the selected region.
" Example: `<leader>aap` for current paragraph
" xmap <leader>a  <Plug>(coc-codeaction-selected)
" nmap <leader>a  <Plug>(coc-codeaction-selected)

" Remap keys for applying codeAction to the current buffer.
" nmap <leader>ac  <Plug>(coc-codeaction)
" Apply AutoFix to problem on the current line.
" nmap <leader>qf  <Plug>(coc-fix-current)

" Map function and class text objects
" NOTE: Requires 'textDocument.documentSymbol' support from the language server.
xmap if <Plug>(coc-funcobj-i)
omap if <Plug>(coc-funcobj-i)
xmap af <Plug>(coc-funcobj-a)
omap af <Plug>(coc-funcobj-a)
xmap ic <Plug>(coc-classobj-i)
omap ic <Plug>(coc-classobj-i)
xmap ac <Plug>(coc-classobj-a)
omap ac <Plug>(coc-classobj-a)

" Use CTRL-S for selections ranges.
" Requires 'textDocument/selectionRange' support of LS, ex: coc-tsserver
nmap <silent> <C-s> <Plug>(coc-range-select)
xmap <silent> <C-s> <Plug>(coc-range-select)

" Add `:Format` command to format current buffer.
command! -nargs=0 Format :call CocAction('format')

" Add `:Fold` command to fold current buffer.
command! -nargs=? Fold :call     CocAction('fold', <f-args>)

" Add `:OR` command for organize imports of the current buffer.
command! -nargs=0 OR   :call     CocAction('runCommand', 'editor.action.organizeImport')

" Add (Neo)Vim's native statusline support.
" NOTE: Please see `:h coc-status` for integrations with external plugins that
" provide custom statusline: lightline.vim, vim-airline.
set statusline^=%{coc#status()}%{get(b:,'coc_current_function','')}

" Mappings for CoCList
nnoremap <silent><nowait> <space>l  :<C-u>CocList<cr>
" Show all diagnostics.
" nnoremap <silent><nowait> <space>a  :<C-u>CocList diagnostics<cr>
" " Manage extensions.
" nnoremap <silent><nowait> <space>e  :<C-u>CocList extensions<cr>
" " Show commands.
" nnoremap <silent><nowait> <space>c  :<C-u>CocList commands<cr>
" Find symbol of current document.
nnoremap <silent><nowait> <space>o  :<C-u>CocList outline<cr>
" " Search workspace symbols.
" nnoremap <silent><nowait> <space>s  :<C-u>CocList -I symbols<cr>
" " Do default action for next item.
" nnoremap <silent><nowait> <space>j  :<C-u>CocNext<CR>
" " Do default action for previous item.
" nnoremap <silent><nowait> <space>k  :<C-u>CocPrev<CR>
" " Resume latest coc list.
" nnoremap <silent><nowait> <space>p  :<C-u>CocListResume<CR>

" Plugin settings
" coc-go
" autocmd BufWritePre *.go :call CocAction('runCommand', 'editor.action.organizeImport')

" coc-snippets
" Use <C-j> for both expand and jump (make expand higher priority.)
imap <C-j> <Plug>(coc-snippets-expand-jump)

"}}}
"

" GUI configs
" set guifont=FiraCode:h16
set guifont=FiraCode\ Nerd\ Font:h14
set guioptions-=m
" set guifont=FiraCode\ Nerd\ Font\\:style\\=Medium\\,Regular:h16
" set guifont=FiraCode\ Nerd\ Font\ Mono\\:style\\=Light\\,Regular:h12
" set guifont=Source\ Code\ Pro\\,Source\ Code\ Pro\ Semibold:h16
